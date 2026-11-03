// Extended Kalman filter (spec 010 FR-003; SRD Annex B §B.3): the reference for a manoeuvring
// target. Constant-velocity state (x, y, vx, vy), discrete white-noise-acceleration process noise
// σ_a, bearings-only update with the wrapped innovation, Joseph-form covariance update.
// Initialised at zig_index from the batch least-squares solution and its covariance, then run per
// timestep. Pure functions over typed arrays; the only state is what callers pass in.
import { angleDiff, bearingOf, f32, f32Angle } from "@tma/sim";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { bearingData, PLAUSIBLE } from "./estimate.js";
import { type BearingData, normalEquations, solve4, solveBatch } from "./lsq.js";

export const EKF = "ekf";

/** Estimator name of the EKF at process noise `sigmaA` (m/s²). */
export const ekfName = (sigmaA: number, scales: TrackerScales = {}): string =>
  `${EKF}-sa${String(sigmaA)}${scaleSuffix(scales)}`;

/**
 * Initialisation of both trackers (spec 016). 0 (the default, every frozen reference): the batch
 * solution with σ²(JᵀJ)⁻¹ (`ekfInitialise`). 1: the same fit, refused when degenerate, with the
 * covariance in square-root form (`ekfInitialiseGuarded`). 2: as 1, but a re-initialisation first
 * fits only the last `REINIT_WINDOW` samples, falling back to all of them.
 */
export type GuardedInit = 0 | 1 | 2;

/**
 * Tuning shared by both trackers (spec 010 FR-011, G0 panel): `p0Scale` multiplies the initial
 * covariance σ²(JᵀJ)⁻¹, `rScale` the measurement variance σ². Both default to 1. `guardedInit`
 * (spec 016) selects the initialisation; it defaults to 0.
 */
export interface TrackerScales {
  p0Scale?: number;
  rScale?: number;
  guardedInit?: GuardedInit;
}

/**
 * Name suffix for scales other than 1 and a guarded initialisation (so names without them are
 * unchanged, and every frozen reference keeps its name and rows).
 */
export const scaleSuffix = (s: TrackerScales): string =>
  `${s.p0Scale !== undefined && s.p0Scale !== 1 ? `-p${String(s.p0Scale)}` : ""}${
    s.rScale !== undefined && s.rScale !== 1 ? `-r${String(s.rScale)}` : ""
  }${s.guardedInit !== undefined && s.guardedInit !== 0 ? `-g${String(s.guardedInit)}` : ""}`;

/**
 * Floor on the measurement standard deviation (rad). Only noise-free data (σ = 0) reach it; it
 * keeps the innovation variance positive. 1e-4 rad is far below every σ the generator draws.
 */
export const EKF_MIN_SIGMA_RAD = 1e-4;

/** Filter state at one sample: estimate (x, y, vx, vy) at time t and its covariance (row-major). */
export interface EkfState {
  t: number;
  x: Float64Array;
  p: Float64Array;
}

/** 4×4 row-major product a·b. */
function mul(a: Float64Array, b: Float64Array): Float64Array {
  const c = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[4 * i + k] ?? 0) * (b[4 * k + j] ?? 0);
      c[4 * i + j] = s;
    }
  return c;
}

const transpose = (a: Float64Array): Float64Array =>
  Float64Array.from({ length: 16 }, (_, k) => a[4 * (k % 4) + Math.floor(k / 4)] ?? 0);

/** Closest approach of a guarded batch fit to ownship, at any fitted sample (spec 016, R1). */
export const MIN_FIT_RANGE_M = 100;
/** Largest |R_kk| / smallest |R_kk| of the fit's QR factor a guarded initialisation accepts. */
export const MAX_FIT_CONDITION = 1e7;
/** Samples a level-2 re-initialisation fits first (10 min at 10 s). */
export const REINIT_WINDOW = 60;

/** Constant-velocity transition over τ seconds. */
function transition(tau: number): Float64Array {
  const f = new Float64Array(16);
  for (let k = 0; k < 4; k++) f[5 * k] = 1;
  f[2] = tau;
  f[7] = tau;
  return f;
}

/** Inverse of a symmetric 4×4 matrix, column by column; null if singular. */
function inverse4(a: Float64Array): Float64Array | null {
  const inv = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    const e = new Float64Array(4);
    e[c] = 1;
    const col = solve4(a, e);
    if (col === null) return null;
    for (let r = 0; r < 4; r++) inv[4 * r + c] = col[r] ?? 0;
  }
  return inv;
}

/**
 * Initial state at sample `i` from the batch solution on samples [0, i]: the state propagated to
 * t_i, with covariance σ²(JᵀJ)⁻¹ propagated likewise (the batch fit's own uncertainty). Null when
 * there is no batch solution, it is implausible, or JᵀJ is singular.
 */
export function ekfInitialise(
  d: BearingData,
  i: number,
  sigma: number,
  p0Scale = 1,
): EkfState | null {
  const sol = solveBatch(d, i + 1);
  if (sol === null) return null;
  const t = d.t[i] ?? 0;
  const f = transition(t);
  const x = new Float64Array(4);
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) x[r] = (x[r] ?? 0) + (f[4 * r + k] ?? 0) * (sol.theta[k] ?? 0);
  if (!plausibleState(d, x, i)) return null;
  const { jtj } = normalEquations(d, sol.theta, i + 1);
  const info = inverse4(jtj);
  if (info === null) return null;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2 * p0Scale;
  const p0 = mul(
    mul(
      f,
      info.map((v) => v * r2),
    ),
    transpose(f),
  );
  return { t, x, p: symmetrise(p0) };
}

/**
 * Guarded initial state at sample `i` (spec 016) from the batch solution on samples [from, i].
 * - **Refusals.** Null when there is no batch solution or it is implausible at tᵢ, as
 *   `ekfInitialise`. Also null when the fitted straight track passes within `MIN_FIT_RANGE_M` of
 *   ownship at any fitted sample (a degenerate minimum: one bearing's Jacobian row ∝ 1/ρ then
 *   swamps the rest), or when the fit's QR factor is too ill-conditioned (`MAX_FIT_CONDITION`).
 * - **Covariance.** It comes from a Householder QR factor R of the Jacobian, parameterised at tᵢ
 *   (columns ∂h/∂x_i, ∂h/∂y_i, (t − tᵢ)·∂h/∂x_i, (t − tᵢ)·∂h/∂y_i): P = σ²·p0Scale · R⁻¹R⁻ᵀ.
 *   There JᵀJ is never formed or inverted, and P is S Sᵀ, symmetric and positive definite by
 *   construction.
 */
export function ekfInitialiseGuarded(
  d: BearingData,
  i: number,
  sigma: number,
  p0Scale = 1,
  from = 0,
): EkfState | null {
  const w = windowOf(d, from, i);
  const sol = solveBatch(w, i - from + 1);
  if (sol === null) return null;
  const ti = d.t[i] ?? 0;
  const [x0 = 0, y0 = 0, vx = 0, vy = 0] = sol.theta;
  const x = Float64Array.from([x0 + vx * ti, y0 + vy * ti, vx, vy]);
  if (!plausibleState(d, x, i)) return null;
  // Jacobian rows at tᵢ, and the closest approach of the fitted track.
  const rows: number[][] = [];
  for (let k = from; k <= i; k++) {
    if (d.valid[k] !== 1) continue;
    const t = d.t[k] ?? 0;
    const dx = x0 + vx * t - (d.ownX[k] ?? 0);
    const dy = y0 + vy * t - (d.ownY[k] ?? 0);
    const rho2 = dx * dx + dy * dy;
    if (!(Math.sqrt(rho2) >= MIN_FIT_RANGE_M)) return null;
    const a = dy / rho2;
    const b = -dx / rho2;
    rows.push([a, b, (t - ti) * a, (t - ti) * b]);
  }
  if (rows.length < 4) return null;
  const r = qrFactor(rows);
  if (r === null) return null;
  const s = upperInverse(r);
  const k2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2 * p0Scale;
  const p = new Float64Array(16);
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++) {
      let v = 0;
      for (let c = Math.max(a, b); c < 4; c++) v += (s[4 * a + c] ?? 0) * (s[4 * b + c] ?? 0);
      p[4 * a + b] = k2 * v;
    }
  return { t: ti, x, p };
}

/** Samples [from, i] of `d` as their own bearing data (absolute times kept). */
function windowOf(d: BearingData, from: number, i: number): BearingData {
  if (from === 0) return d;
  return {
    t: d.t.subarray(from, i + 1),
    ownX: d.ownX.subarray(from, i + 1),
    ownY: d.ownY.subarray(from, i + 1),
    bearing: d.bearing.subarray(from, i + 1),
    valid: d.valid.subarray(from, i + 1),
  };
}

/**
 * The 4×4 upper-triangular factor R of the m×4 matrix `rows` (Householder QR), or null when its
 * conditioning estimate max|R_kk| / min|R_kk| exceeds `MAX_FIT_CONDITION` or is not finite.
 */
function qrFactor(rows: number[][]): Float64Array | null {
  const a = rows.map((row) => Float64Array.from(row));
  const m = a.length;
  for (let c = 0; c < 4; c++) {
    let norm = 0;
    for (let k = c; k < m; k++) norm += (a[k]?.[c] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    if (!(norm > 0) || !Number.isFinite(norm)) return null;
    const head = a[c]?.[c] ?? 0;
    const alpha = head > 0 ? -norm : norm;
    const v = new Float64Array(m - c);
    for (let k = c; k < m; k++) v[k - c] = a[k]?.[c] ?? 0;
    v[0] = (v[0] ?? 0) - alpha;
    let vv = 0;
    for (const e of v) vv += e * e;
    if (!(vv > 0)) continue;
    for (let j = c; j < 4; j++) {
      let dot = 0;
      for (let k = c; k < m; k++) dot += (v[k - c] ?? 0) * (a[k]?.[j] ?? 0);
      const f = (2 * dot) / vv;
      for (let k = c; k < m; k++) {
        const row = a[k];
        if (row !== undefined) row[j] = (row[j] ?? 0) - f * (v[k - c] ?? 0);
      }
    }
  }
  const r = new Float64Array(16);
  for (let k = 0; k < 4; k++) for (let j = k; j < 4; j++) r[4 * k + j] = a[k]?.[j] ?? 0;
  const diag = [0, 1, 2, 3].map((k) => Math.abs(r[5 * k] ?? 0));
  const cond = Math.max(...diag) / Math.min(...diag);
  return Number.isFinite(cond) && cond <= MAX_FIT_CONDITION ? r : null;
}

/** Inverse of a non-singular 4×4 upper-triangular matrix (back substitution). */
function upperInverse(r: Float64Array): Float64Array {
  const s = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    s[5 * c] = 1 / (r[5 * c] ?? 1);
    for (let row = c - 1; row >= 0; row--) {
      let v = 0;
      for (let k = row + 1; k <= c; k++) v += (r[4 * row + k] ?? 0) * (s[4 * k + c] ?? 0);
      s[4 * row + c] = -v / (r[5 * row] ?? 1);
    }
  }
  return s;
}

/**
 * The initialiser `level` selects (spec 016): at the first initialisation (`reinit` false) and at
 * level 1, the guarded fit on every sample so far; at level 2 a re-initialisation first tries the
 * last `REINIT_WINDOW` samples. Level 0 is `ekfInitialise`, unchanged.
 */
export function initialiseAt(
  d: BearingData,
  i: number,
  sigma: number,
  p0Scale: number,
  level: GuardedInit,
  reinit: boolean,
): EkfState | null {
  if (level === 0) return ekfInitialise(d, i, sigma, p0Scale);
  if (level === 2 && reinit && i + 1 > REINIT_WINDOW) {
    const recent = ekfInitialiseGuarded(d, i, sigma, p0Scale, i + 1 - REINIT_WINDOW);
    if (recent !== null) return recent;
  }
  return ekfInitialiseGuarded(d, i, sigma, p0Scale);
}

function symmetrise(p: Float64Array): Float64Array {
  const s = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) s[4 * i + j] = ((p[4 * i + j] ?? 0) + (p[4 * j + i] ?? 0)) / 2;
  return s;
}

/** Predict to time t: x ← F x, P ← F P Fᵀ + Q (white-noise acceleration, σ_a m/s²). */
export function ekfPredictStep(st: EkfState, t: number, sigmaA: number): EkfState {
  const tau = t - st.t;
  const f = transition(tau);
  const [x = 0, y = 0, vx = 0, vy = 0] = st.x;
  const xn = Float64Array.from([x + vx * tau, y + vy * tau, vx, vy]);
  const q = new Float64Array(16);
  const q2 = sigmaA * sigmaA;
  const a = (q2 * tau ** 4) / 4;
  const b = (q2 * tau ** 3) / 2;
  const c = q2 * tau * tau;
  q[0] = a;
  q[5] = a;
  q[2] = b;
  q[8] = b;
  q[7] = b;
  q[13] = b;
  q[10] = c;
  q[15] = c;
  const p = mul(mul(f, st.p), transpose(f)).map((v, k) => v + (q[k] ?? 0));
  return { t, x: xn, p: symmetrise(p) };
}

/** Bearing update with measurement z (rad) from ownship (ox, oy), variance r2 (Joseph form). */
export function ekfUpdate(st: EkfState, z: number, ox: number, oy: number, r2: number): EkfState {
  const [x = 0, y = 0] = st.x;
  const dx = x - ox;
  const dy = y - oy;
  const rho2 = dx * dx + dy * dy;
  const h = [dy / rho2, -dx / rho2, 0, 0];
  const ph = new Float64Array(4);
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 4; k++) ph[i] = (ph[i] ?? 0) + (st.p[4 * i + k] ?? 0) * (h[k] ?? 0);
  let s = r2;
  for (let k = 0; k < 4; k++) s += (h[k] ?? 0) * (ph[k] ?? 0);
  const kGain = ph.map((v) => v / s);
  const nu = angleDiff(z, bearingOf(dx, dy));
  const xn = st.x.map((v, i) => v + (kGain[i] ?? 0) * nu);
  // Joseph form: P ← (I − KH) P (I − KH)ᵀ + K r² Kᵀ.
  const ikh = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) ikh[4 * i + j] = (i === j ? 1 : 0) - (kGain[i] ?? 0) * (h[j] ?? 0);
  const p = mul(mul(ikh, st.p), transpose(ikh)).map(
    (v, k) => v + r2 * (kGain[Math.floor(k / 4)] ?? 0) * (kGain[k % 4] ?? 0),
  );
  return { t: st.t, x: xn, p: symmetrise(p) };
}

/** Within `PLAUSIBLE` (speed and range), and finite. */
function plausibleState(d: BearingData, x: Float64Array, i: number): boolean {
  const [px = NaN, py = NaN, vx = NaN, vy = NaN] = x;
  const range = Math.hypot(px - (d.ownX[i] ?? 0), py - (d.ownY[i] ?? 0));
  return (
    [px, py, vx, vy].every(Number.isFinite) &&
    Math.hypot(vx, vy) <= PLAUSIBLE.maxSpeedMps &&
    range > 0 &&
    range <= PLAUSIBLE.maxRangeM
  );
}

function stateRow(d: BearingData, x: Float64Array, i: number, converged: boolean): PredictionRow {
  const [px = 0, py = 0, vx = 0, vy = 0] = x;
  return {
    timestamp_s: f32(d.t[i] ?? 0),
    range_m: f32(Math.hypot(px - (d.ownX[i] ?? 0), py - (d.ownY[i] ?? 0))),
    course_rad: f32Angle(bearingOf(vx, vy)),
    speed_mps: f32(Math.hypot(vx, vy)),
    x_m: f32(px),
    y_m: f32(py),
    converged,
    iterations: 0,
  };
}

const emptyRow = (d: BearingData, i: number): PredictionRow => ({
  timestamp_s: f32(d.t[i] ?? 0),
  range_m: 0,
  course_rad: 0,
  speed_mps: 0,
  x_m: 0,
  y_m: 0,
  converged: false,
  iterations: 0,
});

/** Samples between re-initialisation attempts while the filter has no state. */
export const EKF_REINIT_EVERY = 6;

/**
 * EKF estimate for one scenario: one row per sample from zig_index + 1 to the end, as the
 * classical per-timestep mode, each using only bearings up to and including that sample. The
 * filter is initialised at zig_index (`ekfInitialise`). A state outside `PLAUSIBLE` is reported
 * non-converged and the filter re-initialises from the batch solution on the samples so far, at
 * once and then every `EKF_REINIT_EVERY` samples until it succeeds; rows without a state are
 * non-converged. Measurement noise is the scenario's σ (floored at `EKF_MIN_SIGMA_RAD`).
 */
export function ekfPredict(s: Scenario, sigmaA: number, scales: TrackerScales = {}): Prediction {
  if (!(sigmaA >= 0)) throw new Error(`EKF process noise must be ≥ 0, got ${String(sigmaA)}`);
  const { p0Scale = 1, rScale = 1, guardedInit = 0 } = scales;
  if (!(p0Scale > 0) || !(rScale > 0)) throw new Error("EKF scales must be > 0");
  if (![0, 1, 2].includes(guardedInit)) throw new Error("EKF guardedInit must be 0, 1 or 2");
  const d = bearingData(s);
  const n = s.metadata.samples;
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2 * rScale;
  const rows: PredictionRow[] = [];
  const first = s.metadata.zig_index + 1;
  let st = first - 1 < n ? initialiseAt(d, first - 1, sigma, p0Scale, guardedInit, false) : null;
  let lastTry = first - 1;
  for (let i = first; i < n; i++) {
    if (st !== null) {
      st = ekfPredictStep(st, d.t[i] ?? 0, sigmaA);
      if (d.valid[i] === 1)
        st = ekfUpdate(st, d.bearing[i] ?? 0, d.ownX[i] ?? 0, d.ownY[i] ?? 0, r2);
      if (plausibleState(d, st.x, i)) {
        rows.push(stateRow(d, st.x, i, true));
        continue;
      }
      rows.push(stateRow(d, st.x, i, false));
      st = null;
      lastTry = i - EKF_REINIT_EVERY;
    } else {
      rows.push(emptyRow(d, i));
    }
    if (i - lastTry >= EKF_REINIT_EVERY) {
      st = initialiseAt(d, i, sigma, p0Scale, guardedInit, true);
      lastTry = i;
    }
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: ekfName(sigmaA, scales),
    mode: "per_timestep",
    rows,
  };
}
