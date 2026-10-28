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
export const ekfName = (sigmaA: number): string => `${EKF}-sa${String(sigmaA)}`;

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
export function ekfInitialise(d: BearingData, i: number, sigma: number): EkfState | null {
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
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2;
  const p0 = mul(
    mul(
      f,
      info.map((v) => v * r2),
    ),
    transpose(f),
  );
  return { t, x, p: symmetrise(p0) };
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
export function ekfPredict(s: Scenario, sigmaA: number): Prediction {
  if (!(sigmaA >= 0)) throw new Error(`EKF process noise must be ≥ 0, got ${String(sigmaA)}`);
  const d = bearingData(s);
  const n = s.metadata.samples;
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2;
  const rows: PredictionRow[] = [];
  const first = s.metadata.zig_index + 1;
  let st = first - 1 < n ? ekfInitialise(d, first - 1, sigma) : null;
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
      st = ekfInitialise(d, i, sigma);
      lastTry = i;
    }
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: ekfName(sigmaA),
    mode: "per_timestep",
    rows,
  };
}
