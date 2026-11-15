// Composite solver (spec 025, SRD Annex D): batch least squares while its constant-velocity fit
// still explains the recent bearings, the fused tracker from the first row where it does not.
// Spec 024 found least squares at the Cramér–Rao bound on straight legs, and the fused tracker the
// better estimator after a manoeuvre; the switch keeps each where it is strong. Pure functions over
// prediction records and bearings; causal, since every row uses bearings up to its own time only.
import { angleDiff, bearingOf } from "@tma/sim";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { bearingData } from "./estimate.js";
import type { BearingData } from "./lsq.js";

/** The fit check's settings: residual window (samples) and threshold (mean r² / σ²). */
export interface CompositeParams {
  window: number;
  threshold: number;
}

/** Floor on σ in the fit statistic, so a noise-free scenario gives a finite statistic (rad). */
export const FIT_SIGMA_FLOOR_RAD = (0.1 * Math.PI) / 180;

/** Estimator name of the composite of a classical (least-squares) file and a fused-tracker file. */
export const compositeName = (classical: string, fused: string, p: CompositeParams): string =>
  `composite-${classical}-${fused}-w${String(p.window)}-c${String(p.threshold)}`;

/**
 * The fit statistic at sample i: mean squared bearing residual of the least-squares row's
 * constant-velocity track over the valid samples in (i − window, i], divided by σ² (floored). The
 * row gives the position at tᵢ and the velocity; the track is extrapolated back from there.
 * Null when the window holds no valid sample.
 */
export function fitStatistic(
  d: BearingData,
  row: PredictionRow,
  i: number,
  window: number,
  sigma: number,
): number | null {
  const vx = row.speed_mps * Math.sin(row.course_rad);
  const vy = row.speed_mps * Math.cos(row.course_rad);
  const ti = d.t[i] ?? 0;
  let sum = 0;
  let n = 0;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) {
    if (d.valid[j] !== 1) continue;
    const dt = (d.t[j] ?? 0) - ti;
    const h = bearingOf(row.x_m + vx * dt - (d.ownX[j] ?? 0), row.y_m + vy * dt - (d.ownY[j] ?? 0));
    const r = angleDiff(d.bearing[j] ?? 0, h);
    sum += r * r;
    n++;
  }
  if (n === 0) return null;
  const s = Math.max(sigma, FIT_SIGMA_FLOOR_RAD);
  return sum / n / (s * s);
}

/**
 * The composite of one scenario. Rows follow the classical file's timestamps. At each row:
 * - once switched, the fused tracker's row (the switch latches: a constant-velocity fit from the
 *   window start cannot recover after a real manoeuvre);
 * - a non-converged least-squares row, or one with no valid bearing in its window: the fused
 *   tracker's row, without latching;
 * - a fit statistic above the threshold: switch, and the fused tracker's row;
 * - otherwise the least-squares row.
 * Both inputs must be per-timestep predictions of this scenario; the fused file must have a row
 * at every classical timestamp.
 */
export function compositePredict(
  s: Scenario,
  classical: Prediction,
  fused: Prediction,
  p: CompositeParams,
): Prediction {
  const id = s.metadata.index;
  if (classical.scenario_index !== id || fused.scenario_index !== id)
    throw new Error(`composite: predictions are not for scenario ${String(id)}`);
  if (classical.mode !== "per_timestep" || fused.mode !== "per_timestep")
    throw new Error(`scenario ${String(id)}: the composite needs per-timestep rows from both`);
  const d = bearingData(s);
  const dt = s.metadata.parameters.dt_s;
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const fusedAt = new Map<number, PredictionRow>();
  for (const r of fused.rows) fusedAt.set(Math.round(r.timestamp_s / dt), r);
  let switched = false;
  const rows = classical.rows.map((c) => {
    const i = Math.round(c.timestamp_s / dt);
    const f = fusedAt.get(i);
    if (f === undefined)
      throw new Error(
        `scenario ${String(id)}: the fused file has no row at t = ${String(c.timestamp_s)}`,
      );
    if (switched || !c.converged) return f;
    const stat = fitStatistic(d, c, i, p.window, sigma);
    if (stat === null) return f;
    if (stat > p.threshold) {
      switched = true;
      return f;
    }
    return c;
  });
  return {
    record: "prediction",
    scenario_index: id,
    estimator: compositeName(classical.estimator, fused.estimator, p),
    mode: "per_timestep",
    rows,
  };
}
