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

/**
 * Plausibility bounds for a surface target: 25 m/s (≈ 49 kt, over twice the generator's 20 kt
 * maximum) and 100 km range (over three times its 30 km). They catch the unobservable "range → ∞"
 * valley, where bearings fit equally well with ever larger range and speed, without encoding the
 * generator's own parameter ranges.
 */
export const PLAUSIBLE = { maxSpeedMps: 25, maxRangeM: 100_000 };

export function plausible(d: BearingData, sol: Solution, i: number): boolean {
  const [x0 = 0, y0 = 0, vx = 0, vy = 0] = sol.theta;
  const t = d.t[i] ?? 0;
  const range = Math.hypot(x0 + vx * t - (d.ownX[i] ?? 0), y0 + vy * t - (d.ownY[i] ?? 0));
  return Math.hypot(vx, vy) <= PLAUSIBLE.maxSpeedMps && range <= PLAUSIBLE.maxRangeM;
}

/** Prefer a plausible solution, then the lower cost. */
function better(d: BearingData, a: Solution, b: Solution, i: number): boolean {
  const pa = plausible(d, a, i);
  const pb = plausible(d, b, i);
  if (pa !== pb) return pa;
  return a.cost < b.cost;
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
 *   end, each using only bearings up to and including that sample. Warm-started from the previous
 *   row; a fresh grid start is also tried at the first row, every `GRID_EVERY` rows, and whenever
 *   the warm solution is non-converged or implausible, and the lower-cost solution is kept.
 *
 * In both modes a solution outside `PLAUSIBLE` (speed or range far beyond any surface target) is
 * reported with `converged = false`, so it counts as a gross error rather than a silent answer, and
 * the next row restarts from the grid instead of inheriting it.
 */
export function classicalPredict(
  s: Scenario,
  mode: PredictionMode,
  opts: SolveOptions = DEFAULT_SOLVE_OPTIONS,
): Prediction {
  const d = bearingData(s);
  const n = s.metadata.samples;
  const rows: PredictionRow[] = [];
  const emit = (sol: Solution | null, i: number): void => {
    if (sol === null) {
      rows.push(emptyRow(d, i));
      return;
    }
    const row = rowAt(d, sol, i);
    rows.push(plausible(d, sol, i) ? row : { ...row, converged: false });
  };
  if (mode === "final") {
    emit(solveBatch(d, n, opts), n - 1);
  } else {
    let prev: Solution | null = null;
    const first = s.metadata.zig_index + 1;
    for (let i = first; i < n; i++) {
      const warm: Solution | null =
        prev === null ? null : levenbergMarquardt(d, prev.theta, i + 1, opts);
      let sol: Solution | null = warm;
      const needGrid =
        warm === null ||
        !warm.converged ||
        !plausible(d, warm, i) ||
        (opts.gridEvery > 0 && (i - first) % opts.gridEvery === 0);
      if (needGrid) {
        const fresh = solveBatch(d, i + 1, opts);
        if (fresh !== null && (sol === null || better(d, fresh, sol, i))) sol = fresh;
      }
      emit(sol, i);
      prev = sol !== null && plausible(d, sol, i) ? sol : null;
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
