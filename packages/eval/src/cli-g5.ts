// tma-g5 (spec 012 FR-005; SRD Annex C §C.5): G5 for one or two learned trackers against the
// frozen reference on one split (gate-g5.ts). On a validation split it writes diagnostic.json and
// report.json: every estimator given (trackers, reference, --also files: the other reference,
// batch least squares, naive) on the G5 rows, medians and P90s overall, settled and unsettled, by
// gate time and by manoeuvre mix (FR-006). A test split is refused until the decision record that
// binds it exists (spec 012 T008).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import type { Scenario } from "@tma/types";
import { selectQuantile } from "./bootstrap.js";
import { rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { prettyJson } from "./experiment.js";
import { G5_GATE_MIN, type G5Row, g5Checks, g5Rows, g5Verdict } from "./gate-g5.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";
import { manoeuvreBand } from "./slices.js";

const USAGE =
  "usage: tma-g5 --truth <split.f32pack> --tracker <pred.ndjson> [--tracker <pred.ndjson>] --reference <pred.ndjson> [--also <pred.ndjson>]... --experiment <dir>";

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
    },
  });
  const { truth, reference, experiment } = values;
  const trackers = values.tracker ?? [];
  if (!truth || !reference || !experiment || trackers.length < 1 || trackers.length > 2)
    throw new UsageError(USAGE);
  if (readDataset(truth).header.split === "test")
    throw new UsageError(
      `${truth}: a test split needs the committed phase-4 decision record and its binding (spec 012 T008), not yet built`,
    );
  const sets = trackers.map((p) => openPredictionSet(p, truth));
  const ref = openPredictionSet(reference, truth);
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  const out = join(experiment, "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G5 split is scored once`);
  const scenarios = Array.from(scenarioSource(truth));
  const checks = sets.flatMap((t) => g5Checks(scenarios, t, ref));
  const verdict = {
    ...g5Verdict(
      checks,
      sets.map((t) => t.label),
    ),
    decided_by: "validation diagnostic (spec 012 FR-005): not a gate decision",
  };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  writeFileSync(
    join(experiment, "report.json"),
    prettyJson(g5Report(scenarios, [...sets, ref, ...also])),
  );
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
