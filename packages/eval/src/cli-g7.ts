// tma-g7 (spec 018; SRD Annex C §C.13): calibrated uncertainty of a tracker against the reference.
// - Validation (any split but test):
//   - fits each estimator's 50% and 90% multipliers per output on every G5 row
//     (calibration.json, the values a decision would freeze);
//   - an honest two-fold check: multipliers fitted on even-indexed scenarios are judged on the
//     odd-indexed ones by the G7 checks (diagnostic.json). Nothing is gated.
// - Test (the gate): the multipliers come from the committed decision (`calibrations`).
//   G5's bindings all hold (spec 015):
//   - the decision, its seed, plans, reference and carried names;
//   - data at or after the decision;
//   - frozen models and the prediction chain;
//   - a re-computed sample of both files;
//   - scored once.
//   Writes verdict.json and scoring.json (exit 3 unless pass).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileDigest } from "@tma/classical";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import type { GateRecomputation, GateScoring, Scenario, UncertaintyCalibration } from "@tma/types";
import {
  priorGateScorings,
  repoTop,
  requireG5Binding,
  requirePredictionChain,
  requireScoredOnce,
} from "./cli-g5.js";
import { prettyJson } from "./experiment.js";
import { g5Rows } from "./gate-g5.js";
import { G7_OUTPUTS, fitCalibration, g7Checks, g7Verdict } from "./gate-g7.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";
import { digestCache, requireRecomputed, sampleScenarios } from "./recompute.js";

const USAGE =
  "usage: tma-g7 --truth <split.f32pack> --tracker <pred.ndjson> --reference <pred.ndjson> --experiment <dir> " +
  "[--also <pred.ndjson>... --decision <decision.json> --plan <plan.json>... --model <model dir>... [--repeat-of <earlier experiment>]] (bindings required on a test split)";

/** The decision's multipliers for `estimators`, each output present exactly once. */
export function requireCalibrations(
  cal: readonly UncertaintyCalibration[],
  estimators: string[],
  where: string,
): UncertaintyCalibration[] {
  const out: UncertaintyCalibration[] = [];
  for (const e of estimators)
    for (const o of G7_OUTPUTS) {
      const m = cal.filter((c) => c.estimator === e && c.output === o);
      if (m.length !== 1)
        throw new UsageError(
          `${where} freezes ${String(m.length)} calibrations for ${e} ${o}, not 1`,
        );
      const c = m[0];
      if (c === undefined || !(c.q50 > 0) || !(c.q90 >= c.q50) || !Number.isFinite(c.q90))
        throw new UsageError(`${where}: calibration for ${e} ${o} must have 0 < q50 ≤ q90 < ∞`);
      out.push(c);
    }
  return out;
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      tracker: { type: "string" },
      reference: { type: "string" },
      also: { type: "string", multiple: true },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
      "repeat-of": { type: "string" },
    },
  });
  const { truth, tracker, reference, experiment } = values;
  if (!truth || !tracker || !reference || !experiment) throw new UsageError(USAGE);
  const gate = readDataset(truth).header.split === "test";
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G7 split is scored once`);
  const t = openPredictionSet(tracker, truth);
  const r = openPredictionSet(reference, truth);
  const scenarios: Scenario[] = Array.from(scenarioSource(truth));
  if (!gate) {
    if (values.decision || values["repeat-of"])
      throw new UsageError("--decision and --repeat-of apply to a test split only");
    const rows = g5Rows(scenarios);
    const full = [...fitCalibration(rows, t), ...fitCalibration(rows, r)];
    const even = scenarios.filter((s) => s.metadata.index % 2 === 0);
    const odd = scenarios.filter((s) => s.metadata.index % 2 === 1);
    const evenRows = g5Rows(even);
    const fold = [...fitCalibration(evenRows, t), ...fitCalibration(evenRows, r)];
    const verdict = {
      ...g7Verdict(g7Checks(odd, t, r, fold)),
      decided_by:
        "validation diagnostic (spec 018): multipliers fitted on even-indexed scenarios, judged on odd-indexed ones; not a gate decision",
    };
    mkdirSync(experiment, { recursive: true });
    writeFileSync(
      join(experiment, "calibration.json"),
      prettyJson({
        fitted_on: "every G5 row of this split",
        calibrations: full,
        two_fold: { fitted_on_even: fold },
      }),
    );
    writeFileSync(out, prettyJson(verdict));
    return {
      experiment,
      calibrations: full,
      checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
    };
  }
  if (!values.decision || !values.plan?.length || !values.model?.length)
    throw new UsageError(`a test split needs --decision, --plan and --model\n${USAGE}`);
  const d = requireG5Binding({
    decisionPath: values.decision,
    planPaths: values.plan,
    modelDirs: values.model,
    truthPath: truth,
    trackers: [t.estimator],
    reference: r.estimator,
  });
  const cal = requireCalibrations(
    d.calibrations ?? [],
    [t.estimator, r.estimator],
    values.decision,
  );
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  const digestOf = digestCache();
  requirePredictionChain([t], [r, ...also], values.model, digestOf);
  const top = repoTop();
  const current = {
    decision: relative(top, resolve(values.decision)),
    decision_sha256: fileDigest(values.decision),
    test_seed: String(d.test_seed),
  };
  const repeatOf = requireScoredOnce(
    priorGateScorings(join(top, "experiments"), "G7"),
    current,
    experiment,
    values["repeat-of"],
    top,
    "G7",
  );
  const sample = sampleScenarios([...new Set(g5Rows(scenarios).map((x) => x.s.metadata.index))]);
  const given = [t, r, ...also];
  const recomputed = [t, r]
    .map((x) => requireRecomputed(x, given, scenarios, sample, digestOf))
    .filter((x): x is GateRecomputation => x !== null);
  const verdict = g7Verdict(g7Checks(scenarios, t, r, cal));
  const scoring: GateScoring = {
    gate: "G7",
    ...current,
    truth_sha256: fileDigest(truth),
    recomputed,
    ...(repeatOf === undefined ? {} : { repeat_of: repeatOf }),
  };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  writeFileSync(join(experiment, "scoring.json"), prettyJson(scoring));
  if (verdict.result !== "pass") process.exitCode = 3;
  return {
    experiment,
    gate: "G7",
    result: verdict.result,
    sample_sha256: createHash("sha256").update(sample.join(",")).digest("hex"),
    checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
  };
}

if (isMain(import.meta.url)) {
  const code = runCli(main, process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
