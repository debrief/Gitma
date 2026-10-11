import { bearingOf, f32, f32Angle } from "@tma/sim";
import type { Prediction, PredictionMode, PredictionRow, Scenario } from "@tma/types";
import {
  type BearingData,
  DEFAULT_SOLVE_OPTIONS,
  levenbergMarquardt,
  type SolveOptions,
  type Solution,
  solveBatch,
} from "./lsq.js";

export const CLASSICAL = "classical";

export function bearingData(s: Scenario): BearingData {
  const n = s.metadata.samples;
  const d: BearingData = {
    t: new Float64Array(n),
    ownX: new Float64Array(n),
    ownY: new Float64Array(n),
    bearing: new Float64Array(n),
    valid: new Uint8Array(n),
  };
  s.ownship.states.forEach((st, i) => {
    d.t[i] = st.timestamp_s;
    d.ownX[i] = st.x_m;
    d.ownY[i] = st.y_m;
  });
  s.observations.forEach((o, i) => {
    d.bearing[i] = o.bearing_rad;
    d.valid[i] = o.valid ? 1 : 0;
  });
  return d;
}

/** The target estimate implied by a solution at sample `i`, float32-rounded. */
export function rowAt(d: BearingData, sol: Solution, i: number): PredictionRow {
  const [x0 = 0, y0 = 0, vx = 0, vy = 0] = sol.theta;
  const t = d.t[i] ?? 0;
  const x = x0 + vx * t;
  const y = y0 + vy * t;
  return {
    timestamp_s: f32(t),
    range_m: f32(Math.hypot(x - (d.ownX[i] ?? 0), y - (d.ownY[i] ?? 0))),
    course_rad: f32Angle(bearingOf(vx, vy)),
    speed_mps: f32(Math.hypot(vx, vy)),
    x_m: f32(x),
    y_m: f32(y),
    converged: sol.converged,
    iterations: sol.iterations,
  };
}

/** Row used when no estimate exists (no valid bearings): flagged non-converged, never silent. */
function emptyRow(d: BearingData, i: number): PredictionRow {
  return {
    timestamp_s: f32(d.t[i] ?? 0),
    range_m: 0,
    course_rad: 0,
    speed_mps: 0,
    x_m: 0,
    y_m: 0,
    converged: false,
    iterations: 0,
  };
}

/**
 * Classical estimate for one scenario.
 * - final: one row at the last sample using every bearing.
 * - per_timestep: one row per sample from zig_index + 1 (the first sample off the leg-1 line) to the
 *   end, each using only bearings up to and including that sample; warm-started from the previous
 *   row, with a grid start only at the first row.
 */
export function classicalPredict(
  s: Scenario,
  mode: PredictionMode,
  opts: SolveOptions = DEFAULT_SOLVE_OPTIONS,
): Prediction {
  const d = bearingData(s);
  const n = s.metadata.samples;
  const rows: PredictionRow[] = [];
  if (mode === "final") {
    const sol = solveBatch(d, n, opts);
    rows.push(sol === null ? emptyRow(d, n - 1) : rowAt(d, sol, n - 1));
  } else {
    let prev: Solution | null = null;
    for (let i = s.metadata.zig_index + 1; i < n; i++) {
      const sol: Solution | null =
        prev === null ? solveBatch(d, i + 1, opts) : levenbergMarquardt(d, prev.theta, i + 1, opts);
      rows.push(sol === null ? emptyRow(d, i) : rowAt(d, sol, i));
      if (sol !== null) prev = sol;
    }
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: CLASSICAL,
    mode,
    rows,
  };
}
