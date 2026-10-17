// One scenario's errors (spec 006 FR-006): the SRD §5 per-row definitions from `@tma/eval`.
import { median, mean, rowError, type RowError } from "@tma/eval/browser";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";

export type { RowError };

export const errorOf = (s: Scenario, row: PredictionRow): RowError => rowError(s, row);

export interface ScenarioErrors {
  /** Post-zig rows scored (as the gates score them). */
  rows: number;
  rangeRelMedian: number;
  courseDegMedian: number;
  speedKtMedian: number;
  /** Mean position error over the post-zig rows, metres (SRD §5 time-late metric). */
  positionMeanM: number;
  nonConverged: number;
}

/** Medians over the post-zig rows; a non-converged row counts as infinite error, as `tma-eval` scores it. */
export function scenarioErrors(s: Scenario, p: Prediction): ScenarioErrors {
  const rows = p.rows.filter(
    (r) => Math.round(r.timestamp_s / s.metadata.parameters.dt_s) > s.metadata.zig_index,
  );
  const e = rows.map((r) => errorOf(s, r));
  const ok = (v: number, r: RowError): number => (r.converged ? v : Infinity);
  const sorted = (f: (r: RowError) => number): number[] =>
    e.map((r) => ok(f(r), r)).sort((a, b) => a - b);
  return {
    rows: e.length,
    rangeRelMedian: e.length === 0 ? NaN : median(sorted((r) => r.range_rel)),
    courseDegMedian: e.length === 0 ? NaN : median(sorted((r) => r.course_deg)),
    speedKtMedian: e.length === 0 ? NaN : median(sorted((r) => r.speed_kt)),
    positionMeanM: e.length === 0 ? NaN : mean(e.map((r) => ok(r.position_m, r))),
    nonConverged: e.filter((r) => !r.converged).length,
  };
}
