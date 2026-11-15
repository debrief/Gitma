// Composite solver (spec 025, SRD Annex D): batch least squares while its constant-velocity fit
// still explains the recent bearings, the fused tracker from the first row where it does not.
// Spec 024 found least squares at the Cramér–Rao bound on straight legs, and the fused tracker the
// better estimator after a manoeuvre; the switch keeps each where it is strong. Pure functions over
// prediction records and bearings; causal, since every row uses bearings up to its own time only.
//
// Re-armed (spec 025 §D.7, when `leg` is given): after a switch, a new constant-velocity leg is
// fitted from the switch time, anchored by a prior on the fused tracker's log range at the leg's
// start (the new leg's bearings alone rarely determine range). Once the leg holds `leg` samples
// and passes the same fit check, the composite hands back to it; if it breaks again, the fused
// tracker resumes and a new leg starts.
import { angleDiff, bearingOf } from "@tma/sim";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { bearingData, plausible, rowAt } from "./estimate.js";
import { type BearingData, solve4, type Solution } from "./lsq.js";

/**
 * The fit check's settings: residual window (samples) and threshold (mean r² / σ²); with `leg`
 * (samples) and `priorSd` (log-range sd of the anchor), the re-armed composite.
 */
export interface CompositeParams {
  window: number;
  threshold: number;
  leg?: number;
  priorSd?: number;
}

/** Floor on σ in the fit statistic, so a noise-free scenario gives a finite statistic (rad). */
export const FIT_SIGMA_FLOOR_RAD = (0.1 * Math.PI) / 180;

/** Estimator name of the composite of a classical (least-squares) file and a fused-tracker file. */
export const compositeName = (classical: string, fused: string, p: CompositeParams): string =>
  `composite-${classical}-${fused}-w${String(p.window)}-c${String(p.threshold)}` +
  (p.leg === undefined ? "" : `-l${String(p.leg)}-p${String(p.priorSd)}`);

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

/** The anchor of a leg: log range from ownship at the leg's first sample. */
interface Anchor {
  i: number;
  logRange: number;
}

/**
 * Weighted cost of a leg θ = (x0, y0, vx, vy) at t = 0 over valid samples [from, upto):
 * Σ (r_j / σ_b)² + ((log range_a(θ) − log range_a) / σ_p)².
 */
function legCost(
  d: BearingData,
  th: Float64Array,
  from: number,
  upto: number,
  a: Anchor,
  sb: number,
  sp: number,
): number {
  const [x0 = 0, y0 = 0, vx = 0, vy = 0] = th;
  let c = 0;
  for (let j = from; j < upto; j++) {
    if (d.valid[j] !== 1) continue;
    const t = d.t[j] ?? 0;
    const r = angleDiff(
      d.bearing[j] ?? 0,
      bearingOf(x0 + vx * t - (d.ownX[j] ?? 0), y0 + vy * t - (d.ownY[j] ?? 0)),
    );
    c += (r / sb) ** 2;
  }
  const ta = d.t[a.i] ?? 0;
  const ra = Math.hypot(x0 + vx * ta - (d.ownX[a.i] ?? 0), y0 + vy * ta - (d.ownY[a.i] ?? 0));
  return c + ((Math.log(ra) - a.logRange) / sp) ** 2;
}

/** Levenberg–Marquardt on `legCost` (as `levenbergMarquardt`, with the anchor's residual). */
export function anchoredLegFit(
  d: BearingData,
  start: Float64Array,
  from: number,
  upto: number,
  a: Anchor,
  sb: number,
  sp: number,
  maxIterations = 50,
): Solution {
  let th = Float64Array.from(start);
  let c = legCost(d, th, from, upto, a, sb, sp);
  let lambda = 1e-3;
  for (let it = 1; it <= maxIterations; it++) {
    const jtj = new Float64Array(16);
    const jtr = new Float64Array(4);
    const add = (g: number[], r: number): void => {
      for (let p = 0; p < 4; p++) {
        jtr[p] = (jtr[p] ?? 0) + (g[p] ?? 0) * r;
        for (let q = 0; q < 4; q++)
          jtj[4 * p + q] = (jtj[4 * p + q] ?? 0) + (g[p] ?? 0) * (g[q] ?? 0);
      }
    };
    const [x0 = 0, y0 = 0, vx = 0, vy = 0] = th;
    for (let j = from; j < upto; j++) {
      if (d.valid[j] !== 1) continue;
      const t = d.t[j] ?? 0;
      const dx = x0 + vx * t - (d.ownX[j] ?? 0);
      const dy = y0 + vy * t - (d.ownY[j] ?? 0);
      const r2 = dx * dx + dy * dy;
      const gx = dy / r2 / sb;
      const gy = -dx / r2 / sb;
      add([gx, gy, gx * t, gy * t], angleDiff(d.bearing[j] ?? 0, bearingOf(dx, dy)) / sb);
    }
    const ta = d.t[a.i] ?? 0;
    const ax = x0 + vx * ta - (d.ownX[a.i] ?? 0);
    const ay = y0 + vy * ta - (d.ownY[a.i] ?? 0);
    const ar2 = ax * ax + ay * ay;
    const hx = ax / ar2 / sp;
    const hy = ay / ar2 / sp;
    add([hx, hy, hx * ta, hy * ta], (a.logRange - 0.5 * Math.log(ar2)) / sp);
    let accepted = false;
    while (lambda <= 1e12) {
      const damped = Float64Array.from(jtj);
      for (let k = 0; k < 4; k++) damped[5 * k] = (jtj[5 * k] ?? 0) * (1 + lambda);
      const step = solve4(damped, jtr);
      if (step !== null) {
        const next = th.map((v, k) => v + (step[k] ?? 0));
        const cn = legCost(d, next, from, upto, a, sb, sp);
        if (cn <= c) {
          const done = c - cn <= 1e-12 * c || cn < 1e-24;
          th = next;
          c = cn;
          lambda = Math.max(lambda / 10, 1e-12);
          accepted = true;
          if (done) return { theta: th, converged: true, iterations: it, cost: c };
          break;
        }
      }
      lambda *= 10;
    }
    if (!accepted) return { theta: th, converged: true, iterations: it, cost: c };
  }
  return { theta: th, converged: false, iterations: maxIterations, cost: c };
}

/** θ at t = 0 of a row's constant-velocity track (position at the row's time, its velocity). */
function thetaOf(row: PredictionRow): Float64Array {
  const vx = row.speed_mps * Math.sin(row.course_rad);
  const vy = row.speed_mps * Math.cos(row.course_rad);
  return Float64Array.of(row.x_m - vx * row.timestamp_s, row.y_m - vy * row.timestamp_s, vx, vy);
}

/**
 * The composite of one scenario. Rows follow the classical file's timestamps.
 *
 * Without `leg` (the first design, §D.1): at each row,
 * - once switched, the fused tracker's row (the switch latches);
 * - a non-converged least-squares row, or one with no valid bearing in its window: the fused
 *   tracker's row, without latching;
 * - a fit statistic above the threshold: switch, and the fused tracker's row;
 * - otherwise the least-squares row.
 *
 * With `leg` (re-armed, §D.7), after a switch at sample s a leg starts at ℓ = s. At each later row
 * i, while on the fused tracker: once i − ℓ + 1 ≥ leg, the leg is fitted to the bearings [ℓ, i]
 * anchored at the fused tracker's log range at ℓ; if the fit converges, is plausible and passes
 * the fit check, the composite reports it and stays on the leg; if it converges and fails the
 * check, ℓ advances by one window. While on a leg: a failed check switches back to the fused
 * tracker and starts a new leg at that row; a non-converged or implausible fit gives the fused
 * row without changing state. Both inputs must be per-timestep predictions of this scenario; the
 * fused file must have a row at every classical timestamp.
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
  if ((p.leg === undefined) !== (p.priorSd === undefined))
    throw new Error("composite: leg and priorSd are given together");
  const d = bearingData(s);
  const dt = s.metadata.parameters.dt_s;
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const sb = Math.max(sigma, FIT_SIGMA_FLOOR_RAD);
  const fusedAt = new Map<number, PredictionRow>();
  for (const r of fused.rows) fusedAt.set(Math.round(r.timestamp_s / dt), r);
  const fusedRow = (i: number, t: number): PredictionRow => {
    const f = fusedAt.get(i);
    if (f === undefined)
      throw new Error(`scenario ${String(id)}: the fused file has no row at t = ${String(t)}`);
    return f;
  };
  let mode: "lsq" | "fused" | "leg" = "lsq";
  let legStart = 0;
  let legTheta: Float64Array | null = null;
  const startLeg = (i: number): void => {
    legStart = i;
    legTheta = null;
  };
  const rows = classical.rows.map((c) => {
    const i = Math.round(c.timestamp_s / dt);
    const f = fusedRow(i, c.timestamp_s);
    if (mode === "lsq") {
      if (!c.converged) return f;
      const stat = fitStatistic(d, c, i, p.window, sigma);
      if (stat === null) return f;
      if (stat <= p.threshold) return c;
      mode = "fused";
      startLeg(i);
      return f;
    }
    if (p.leg === undefined || p.priorSd === undefined) return f;
    if (mode === "fused" && i - legStart + 1 < p.leg) return f;
    const a0 = fusedRow(legStart, legStart * dt);
    const anchor = { i: legStart, logRange: Math.log(a0.range_m) };
    const sol = anchoredLegFit(d, legTheta ?? thetaOf(a0), legStart, i + 1, anchor, sb, p.priorSd);
    if (!sol.converged || !plausible(d, sol, i) || !(a0.range_m > 0)) {
      legTheta = null;
      return f;
    }
    legTheta = sol.theta;
    const row = rowAt(d, sol, i);
    const stat = fitStatistic(d, row, i, p.window, sigma);
    if (stat !== null && stat <= p.threshold) {
      mode = "leg";
      return row;
    }
    if (mode === "leg") {
      mode = "fused";
      startLeg(i);
    } else if (stat !== null) {
      startLeg(legStart + p.window);
    }
    return f;
  });
  return {
    record: "prediction",
    scenario_index: id,
    estimator: compositeName(classical.estimator, fused.estimator, p),
    mode: "per_timestep",
    rows,
  };
}
