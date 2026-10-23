// Model outputs → Prediction rows (spec 002 research R7): the inverse of the target encoding in
// layout.ts. Pure, so the CLI (`@tma/models`) and the browser viewer (`@tma/demos`) share it.
import { bearingOf, f32, f32Angle } from "@tma/sim";
import type { NormalisationConstants, Prediction, PredictionRow, Scenario } from "@tma/types";
import { ROWS } from "./layout.js";
import { COURSE_SPEED, decodeCourseSpeed, type OutputSpec } from "./output.js";

/** Model outputs per row: log_range_km, then three channels whose meaning `OutputSpec` sets. */
export const NO = 4;

/** Last valid bearing at or before sample i (the derived position uses it, as naive does). */
function lastBearing(s: Scenario, i: number): number | null {
  for (let k = i; k >= 0; k--) {
    const o = s.observations[k];
    if (o?.valid === true) return o.bearing_rad;
  }
  return null;
}

/**
 * One scenario's per-timestep prediction from the model's [ROWS × NO] output (row-major), rows from
 * `first` (default zig_index + 1, as scored) to the last sample. Uses only ownship and bearings
 * from `s`, never target truth. Non-finite outputs or no bearing yet → `converged = false`
 * (scored as gross). The viewer passes `first` = 0 to show the pre-zig (unobservable) rows too.
 * `spec` is the model's output parameterisation (output.ts; default course_speed).
 */
export function outputsToPrediction(
  s: Scenario,
  out: Float32Array,
  norm: NormalisationConstants,
  estimator: string,
  first: number = s.metadata.zig_index + 1,
  spec: OutputSpec = COURSE_SPEED,
): Prediction {
  const n = s.metadata.samples;
  if (out.length !== ROWS * NO) throw new Error(`expected ${String(ROWS * NO)} outputs`);
  const rows: PredictionRow[] = [];
  for (let i = first; i < n; i++) {
    const own = s.ownship.states[i];
    if (own === undefined) throw new Error(`no sample ${String(i)}`);
    const a = i * NO;
    const logR = out[a] ?? NaN;
    const { sin, cos, speed } = decodeCourseSpeed(
      out[a + 1] ?? NaN,
      out[a + 2] ?? NaN,
      out[a + 3] ?? NaN,
      norm,
      spec,
    );
    const range = 1000 * Math.exp(logR);
    const b = lastBearing(s, i);
    const ok =
      b !== null &&
      Number.isFinite(range) &&
      Number.isFinite(speed) &&
      Number.isFinite(sin) &&
      Number.isFinite(cos) &&
      (sin !== 0 || cos !== 0);
    rows.push(
      ok
        ? {
            timestamp_s: own.timestamp_s,
            range_m: f32(range),
            course_rad: f32Angle(bearingOf(sin, cos)),
            speed_mps: f32(speed),
            x_m: f32(own.x_m + range * Math.sin(b)),
            y_m: f32(own.y_m + range * Math.cos(b)),
            converged: true,
          }
        : {
            timestamp_s: own.timestamp_s,
            range_m: 0,
            course_rad: 0,
            speed_mps: 0,
            x_m: 0,
            y_m: 0,
            converged: false,
          },
    );
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator,
    mode: "per_timestep",
    rows,
  };
}
