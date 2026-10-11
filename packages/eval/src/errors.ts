// Per-row errors of an estimate against truth (SRD §5 metric definitions).
import { angleDiff, mpsToKt, radToDeg } from "@tma/sim";
import type { PredictionRow, Scenario } from "@tma/types";

export interface RowError {
  t_since_zig_s: number;
  range_rel: number;
  course_deg: number;
  speed_kt: number;
  position_m: number;
  /** Range error > 50% or the estimator did not converge. */
  gross: boolean;
  converged: boolean;
}

export const GROSS_RANGE_REL = 0.5;

export function rowError(s: Scenario, row: PredictionRow): RowError {
  const dt = s.metadata.parameters.dt_s;
  const i = Math.round(row.timestamp_s / dt);
  const o = s.ownship.states[i];
  const t = s.target.states[i];
  if (o === undefined || t === undefined) {
    throw new Error(
      `scenario ${String(s.metadata.index)}: no truth at t=${String(row.timestamp_s)}`,
    );
  }
  const tSinceZig = row.timestamp_s - s.metadata.zig_time_s;
  // A non-converged row has no estimate: score it as the worst possible on every metric, so a
  // failure can never rank better than a bad estimate (round-1 panel review). Placeholder values
  // in the row (zeros, or an implausible solution) are ignored.
  if (!row.converged) {
    return {
      t_since_zig_s: tSinceZig,
      range_rel: Infinity,
      course_deg: Infinity,
      speed_kt: Infinity,
      position_m: Infinity,
      gross: true,
      converged: false,
    };
  }
  const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  const rangeRel = Math.abs(row.range_m - range) / range;
  return {
    t_since_zig_s: tSinceZig,
    range_rel: rangeRel,
    course_deg: Math.abs(radToDeg(angleDiff(row.course_rad, t.course_rad))),
    speed_kt: Math.abs(mpsToKt(row.speed_mps - t.speed_mps)),
    position_m: Math.hypot(row.x_m - t.x_m, row.y_m - t.y_m),
    gross: !(rangeRel <= GROSS_RANGE_REL),
    converged: true,
  };
}
