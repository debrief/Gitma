// tma-g5 (spec 012 FR-005; SRD Annex C §C.5): G5 for one or two learned trackers against the
// frozen reference on one split (gate-g5.ts). On a validation split it writes diagnostic.json and
// report.json: every estimator given (trackers, reference, --also files: the other reference,
// batch least squares, naive) on the G5 rows, medians and P90s overall, settled and unsettled, by
// gate time and by manoeuvre mix (FR-006). On a test split (the gate) every binding of
// `requireG5Binding` must hold, and it writes verdict.json (exit 3 unless pass).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { ChangeDecision, parseRecord, type Scenario } from "@tma/types";
import { defaultDeps, type G4BindingDeps } from "./cli-g4.js";
import { selectQuantile } from "./bootstrap.js";
import { rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { prettyJson } from "./experiment.js";
import { G5_GATE_MIN, type G5Row, g5Checks, g5Rows, g5Verdict } from "./gate-g5.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";
import { manoeuvreBand } from "./slices.js";

const USAGE =
  "usage: tma-g5 --truth <split.f32pack> --tracker <pred.ndjson> [--tracker <pred.ndjson>] --reference <pred.ndjson> [--also <pred.ndjson>]... --experiment <dir> [--decision <decision.json> (--plan <plan.json> --model <model dir>)...] (bindings required on a test split)";

export interface G5Binding {
  decisionPath: string;
  planPaths: string[];
  modelDirs: string[];
  truthPath: string;
  trackers: string[];
  reference: string;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sb = [...b].sort();
  return a.length === b.length && [...a].sort().every((x, i) => x === sb[i]);
};

/**
 * Every binding a G5 test split needs (spec 012 FR-005, as G4's): the decision is committed; it
 * names this test seed, these plans (whose digests the data must match), this reference and these
 * carried trackers; the data come from a clean tree; and every carried tracker was trained after
 * the decision was committed. Returns the decision, or throws naming the first failure.
 */
export function requireG5Binding(b: G5Binding, deps: G4BindingDeps = defaultDeps): ChangeDecision {
  if (!deps.isCommitted(b.decisionPath))
    throw new UsageError(`${b.decisionPath}: the decision must be committed before G5 is scored`);
  const d = parseRecord(
    ChangeDecision,
    JSON.parse(readFileSync(b.decisionPath, "utf8")),
    b.decisionPath,
    1,
  );
  const h = readDataset(b.truthPath).header;
  if (d.test_seed == null || d.test_seed !== h.dataset_seed)
    throw new UsageError(
      `${b.decisionPath} commits to test seed ${String(d.test_seed)}, the test data are seed ${h.dataset_seed}`,
    );
  if (h.generator_git_dirty !== false)
    throw new UsageError(`${b.truthPath}: generated from a dirty tree (or provenance unknown)`);
  const plans = d.plans ?? [];
  if (plans.length === 0 || !sameSet(plans, b.planPaths))
    throw new UsageError(
      `${b.decisionPath} names plans ${plans.join(", ")}, not ${b.planPaths.join(", ")}`,
    );
  for (const p of b.planPaths) deps.checkDigests(p, dirname(b.truthPath));
  if (d.reference_estimator == null || d.reference_estimator !== b.reference)
    throw new UsageError(
      `${b.decisionPath} freezes reference ${String(d.reference_estimator)}, the reference predictions are ${b.reference}`,
    );
  const carried = d.carried_models ?? [];
  if (carried.length === 0 || !sameSet(carried, b.trackers))
    throw new UsageError(
      `${b.decisionPath} carries ${carried.join(", ")}, the tracker predictions are ${b.trackers.join(", ")}`,
    );
  const ids = b.modelDirs.map((dir) => {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      id?: string;
      git_commit?: string;
    };
    if (typeof m.git_commit !== "string" || !deps.precedes(b.decisionPath, m.git_commit))
      throw new UsageError(
        `the decision was not committed before ${String(m.id)} was trained (commit ${String(m.git_commit)})`,
      );
    return String(m.id);
  });
  if (!sameSet(ids, b.trackers))
    throw new UsageError(
      `--model directories hold ${ids.join(", ")}, not ${b.trackers.join(", ")}`,
    );
  return d;
}

interface Summary {
  estimator: string;
  rows: string;
  metric: string;
  n: number;
  median: number | null;
  p90: number | null;
  non_converged: number;
}

/** Medians and P90s of every set on the G5 rows and their slices (FR-006). */
export function g5Report(truth: Scenario[], sets: PredictionSet[]): Summary[] {
  const all = g5Rows(truth);
  const groups: [string, G5Row[]][] = [
    ["all G5 rows", all],
    ["settled", all.filter((r) => r.settled)],
    ["not settled", all.filter((r) => !r.settled)],
    ...G5_GATE_MIN.map((t): [string, G5Row[]] => [
      `zig+${String(t)}min`,
      all.filter((r) => r.minutes === t),
    ]),
    ...G5_GATE_MIN.map((t): [string, G5Row[]] => [
      `settled, zig+${String(t)}min`,
      all.filter((r) => r.settled && r.minutes === t),
    ]),
  ];
  for (const band of [...new Set(all.map((r) => manoeuvreBand(r.s.metadata)))].sort())
    groups.push([`manoeuvre=${band}`, all.filter((r) => manoeuvreBand(r.s.metadata) === band)]);
  const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);
  const out: Summary[] = [];
  for (const set of sets)
    for (const [label, rows] of groups)
      for (const metric of ["range_rel", "course_deg", "speed_kt"] as const) {
        let nc = 0;
        const xs = rows.map(({ s, k }) => {
          const p = set.byIndex.get(s.metadata.index);
          const dt = s.metadata.parameters.dt_s;
          const r = p?.rows.find((x) => Math.round(x.timestamp_s / dt) === k);
          if (r === undefined || !r.converged) {
            nc++;
            return Infinity;
          }
          return rowError(s, r)[metric];
        });
        out.push({
          estimator: set.label,
          rows: label,
          metric,
          n: xs.length,
          median: xs.length ? finite(selectQuantile(Float64Array.from(xs), 0.5)) : null,
          p90: xs.length ? finite(selectQuantile(Float64Array.from(xs), 0.9)) : null,
          non_converged: nc,
        });
      }
  return out;
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      tracker: { type: "string", multiple: true },
      reference: { type: "string" },
      also: { type: "string", multiple: true },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
    },
  });
  const { truth, reference, experiment } = values;
  const trackers = values.tracker ?? [];
  if (!truth || !reference || !experiment || trackers.length < 1 || trackers.length > 2)
    throw new UsageError(USAGE);
  const sets = trackers.map((p) => openPredictionSet(p, truth));
  const ref = openPredictionSet(reference, truth);
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  const gate = readDataset(truth).header.split === "test";
  if (gate) {
    if (!values.decision || !values.plan?.length || !values.model?.length)
      throw new UsageError(`a test split needs --decision, --plan and --model\n${USAGE}`);
    requireG5Binding({
      decisionPath: values.decision,
      planPaths: values.plan,
      modelDirs: values.model,
      truthPath: truth,
      trackers: sets.map((t) => t.estimator),
      reference: ref.estimator,
    });
  }
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G5 split is scored once`);
  const scenarios = Array.from(scenarioSource(truth));
  const checks = sets.flatMap((t) => g5Checks(scenarios, t, ref));
  const judged = g5Verdict(
    checks,
    sets.map((t) => t.label),
  );
  const verdict = gate
    ? judged
    : { ...judged, decided_by: "validation diagnostic (spec 012 FR-005): not a gate decision" };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  writeFileSync(
    join(experiment, "report.json"),
    prettyJson(g5Report(scenarios, [...sets, ref, ...also])),
  );
  if (gate && verdict.result !== "pass") process.exitCode = 3;
  return {
    experiment,
    gate: verdict.gate,
    result: verdict.result,
    checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
  };
}

if (isMain(import.meta.url)) {
  const code = runCli(main, process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
