// tma-g9 (spec 025; SRD Annex D §D.3): G9 for the composite solver (gate-g9.ts) on one split. The
// composite's two inputs are given: its per-timestep least-squares file (--classical) and its
// fused-tracker file (--fused, the estimator to beat overall), plus the network file the fused
// tracker was built from (--also), and any reported estimators (IMM, EKF, naive).
// On a validation split it writes diagnostic.json and report.json. On a test split (the gate) it
// binds as G5 does (spec 015): the committed decision names the test seed, plans, the composite as
// the carried estimator and the fused tracker as the reference; the data postdate the decision;
// the frozen models are bound by digest; the composite's inputs are the files given, byte for
// byte, and the fused tracker's network input was made with a --model's weights; and a seeded
// sample of the composite, the fused tracker and least squares is re-computed byte for byte.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CLASSICAL, fileDigest } from "@tma/classical";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import type { GateRecomputation, GateScoring } from "@tma/types";
import { BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED } from "./bootstrap.js";
import {
  g5Report,
  priorGateScorings,
  repoTop,
  requireG5Binding,
  requirePredictionChain,
  requireScoredOnce,
} from "./cli-g5.js";
import { prettyJson } from "./experiment.js";
import { g5Rows } from "./gate-g5.js";
import { g9Checks, g9Verdict } from "./gate-g9.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";
import { digestCache, requireRecomputed, sampleScenarios } from "./recompute.js";

const USAGE =
  "usage: tma-g9 --truth <split.f32pack> --composite <composite.ndjson> --classical <lsq.ndjson> --fused <fused.ndjson> [--also <pred.ndjson>]... --experiment <dir> [--decision <decision.json> (--plan <plan.json> --model <model dir>)... [--repeat-of <earlier experiment>]]";

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      composite: { type: "string" },
      classical: { type: "string" },
      fused: { type: "string" },
      also: { type: "string", multiple: true },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
      "repeat-of": { type: "string" },
    },
  });
  const { truth, experiment } = values;
  if (!truth || !values.composite || !values.classical || !values.fused || !experiment)
    throw new UsageError(USAGE);
  const comp = openPredictionSet(values.composite, truth);
  const lsq = openPredictionSet(values.classical, truth);
  const fused = openPredictionSet(values.fused, truth);
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  if (lsq.estimator !== CLASSICAL)
    throw new UsageError(`${values.classical}: estimator ${lsq.estimator}, not ${CLASSICAL}`);
  const digestOf = digestCache();
  // The composite must be built from exactly the files it is compared with.
  const inputs = comp.header?.inputs ?? [];
  const want = [lsq, fused];
  if (
    inputs.length !== 2 ||
    !want.every((w, i) => {
      const inp = inputs[i];
      return inp !== undefined && inp.estimator === w.estimator && inp.sha256 === digestOf(w);
    })
  )
    throw new UsageError(
      `${values.composite}: its inputs are not the --classical and --fused files given, byte for byte`,
    );
  const gate = readDataset(truth).header.split === "test";
  if (!gate && values["repeat-of"] !== undefined)
    throw new UsageError("--repeat-of applies to a test split only");
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G9 split is scored once`);
  let scoring: GateScoring | undefined;
  if (gate) {
    if (!values.decision || !values.plan?.length || !values.model?.length)
      throw new UsageError(`a test split needs --decision, --plan and --model\n${USAGE}`);
    requireG5Binding({
      decisionPath: values.decision,
      planPaths: values.plan,
      modelDirs: values.model,
      truthPath: truth,
      trackers: [comp.estimator],
      reference: fused.estimator,
    });
    // The fused tracker's network input was made with a frozen model's weights.
    requirePredictionChain([fused], also, values.model, digestOf);
    const top = repoTop();
    const current = {
      decision: relative(top, resolve(values.decision)),
      decision_sha256: fileDigest(values.decision),
      test_seed: readDataset(truth).header.dataset_seed,
    };
    const repeatOf = requireScoredOnce(
      priorGateScorings(join(top, "experiments"), "G9"),
      current,
      experiment,
      values["repeat-of"],
      top,
      "G9",
    );
    scoring = {
      gate: "G9",
      ...current,
      truth_sha256: fileDigest(truth),
      ...(repeatOf === undefined ? {} : { repeat_of: repeatOf }),
    };
  }
  const scenarios = Array.from(scenarioSource(truth));
  if (scoring !== undefined) {
    const sample = sampleScenarios([...new Set(g5Rows(scenarios).map((r) => r.s.metadata.index))]);
    const given = [comp, lsq, fused, ...also];
    const recomputed = [comp, fused, lsq]
      .map((t) => requireRecomputed(t, given, scenarios, sample, digestOf))
      .filter((r): r is GateRecomputation => r !== null);
    scoring = { ...scoring, recomputed };
  }
  const checks = g9Checks(scenarios, comp, fused, lsq, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED);
  const judged = g9Verdict(checks);
  const verdict = gate
    ? judged
    : { ...judged, decided_by: "validation diagnostic (spec 025): not a gate decision" };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  if (scoring !== undefined) writeFileSync(join(experiment, "scoring.json"), prettyJson(scoring));
  writeFileSync(
    join(experiment, "report.json"),
    prettyJson(g5Report(scenarios, [comp, fused, lsq, ...also])),
  );
  if (gate && verdict.result !== "pass") process.exitCode = 3;
  return {
    experiment,
    gate: verdict.gate,
    result: verdict.result,
    checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
    ...(scoring === undefined
      ? {}
      : {
          recomputed: (scoring.recomputed ?? []).map(
            (r) => `${r.estimator}: ${String(r.scenarios)} scenarios byte-identical`,
          ),
        }),
  };
}

if (isMain(import.meta.url)) {
  const code = runCli(main, process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
