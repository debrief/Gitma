// Interacting-multiple-model tracker (spec 010; SRD Annex B §B.3 as amended): the gated reference
// for a manoeuvring target. Two extended Kalman filters on the state (x, y, vx, vy, ω):
// - CV: constant velocity, white-noise acceleration σ_cv (ω carried, unused);
// - CT: coordinated turn at rate ω (positive = clockwise, as the generator's turns), white-noise
//   acceleration σ_ct and turn-rate random walk σ_ω.
// Standard IMM cycle (Blom and Bar-Shalom): mix, predict, bearing update with the wrapped
// innovation (Joseph form), model probabilities from the innovation likelihoods, combine.
// Initialised at zig_index from the batch least-squares solution and its covariance, then run per
// timestep. Pure functions over typed arrays; the only state is what callers pass in.
import { angleDiff, bearingOf, f32, f32Angle } from "@tma/sim";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { EKF_MIN_SIGMA_RAD, EKF_REINIT_EVERY, ekfInitialise } from "./ekf.js";
import { bearingData, PLAUSIBLE } from "./estimate.js";
import type { BearingData } from "./lsq.js";

export const IMM = "imm";
const N = 5;

/** IMM tuning: every parameter the decision record freezes. */
export interface ImmParams {
  /** CV model white-noise acceleration (m/s²). */
  sigmaCv: number;
  /** CT model white-noise acceleration (m/s²). */
  sigmaCt: number;
  /** CT model turn-rate random walk (rad/s per √s). */
  sigmaOmega: number;
  /** Probability per second of switching model (Markov chain, both directions). */
  switchPerS: number;
}

/** Estimator name of the IMM with `p`. */
export const immName = (p: ImmParams): string =>
  `${IMM}-cv${String(p.sigmaCv)}-ct${String(p.sigmaCt)}-w${String(p.sigmaOmega)}-s${String(p.switchPerS)}`;

/** Prior turn-rate standard deviation at initialisation (rad/s): about the generator's 3°/s. */
export const IMM_OMEGA0_SD = 0.05;
/** Initial model probabilities: CV, CT. */
export const IMM_MU0: readonly [number, number] = [0.9, 0.1];

interface Gaussian {
  x: Float64Array;
  p: Float64Array;
}

/** Filter state: per-model estimates, model probabilities, time. */
export interface ImmState {
  t: number;
  models: [Gaussian, Gaussian];
  mu: [number, number];
}

const at = (a: Float64Array, i: number, j: number): number => a[N * i + j] ?? 0;

function mul(a: Float64Array, b: Float64Array): Float64Array {
  const c = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += at(a, i, k) * at(b, k, j);
      c[N * i + j] = s;
    }
  return c;
}

const transpose = (a: Float64Array): Float64Array =>
  Float64Array.from({ length: N * N }, (_, k) => at(a, k % N, Math.floor(k / N)));

function symmetrise(p: Float64Array): Float64Array {
  const s = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) s[N * i + j] = (at(p, i, j) + at(p, j, i)) / 2;
  return s;
}

/** Coordinated-turn motion over τ: velocity rotated clockwise by ωτ, position its integral. */
export function ctMotion(s: Float64Array, tau: number): Float64Array {
  const [x = 0, y = 0, vx = 0, vy = 0, w = 0] = s;
  const th = w * tau;
  // sin(θ)/ω and (1 − cos θ)/ω, with their small-ω limits τ and ωτ²/2.
  const a = Math.abs(th) < 1e-9 ? tau : Math.sin(th) / w;
  const b = Math.abs(th) < 1e-9 ? (w * tau * tau) / 2 : (1 - Math.cos(th)) / w;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  return Float64Array.from([
    x + vx * a + vy * b,
    y - vx * b + vy * a,
    vx * c + vy * sn,
    -vx * sn + vy * c,
    w,
  ]);
}

/** Constant-velocity motion over τ; ω is carried unchanged and does not act. */
export function cvMotion(s: Float64Array, tau: number): Float64Array {
  const [x = 0, y = 0, vx = 0, vy = 0, w = 0] = s;
  return Float64Array.from([x + vx * tau, y + vy * tau, vx, vy, w]);
}

/** Jacobian of `f` at `s` by central differences (column j from a step in state j). */
function jacobian(f: (s: Float64Array) => Float64Array, s: Float64Array): Float64Array {
  const j = new Float64Array(N * N);
  for (let c = 0; c < N; c++) {
    const h = c === 4 ? 1e-7 : 1e-4 * Math.max(1, Math.abs(s[c] ?? 0));
    const up = Float64Array.from(s);
    const dn = Float64Array.from(s);
    up[c] = (up[c] ?? 0) + h;
    dn[c] = (dn[c] ?? 0) - h;
    const fu = f(up);
    const fd = f(dn);
    for (let r = 0; r < N; r++) j[N * r + c] = ((fu[r] ?? 0) - (fd[r] ?? 0)) / (2 * h);
  }
  return j;
}

/** White-noise acceleration over τ on (x, y, vx, vy), plus σ_ω²τ on ω. */
function processNoise(tau: number, sigmaA: number, sigmaOmega: number): Float64Array {
  const q = new Float64Array(N * N);
  const q2 = sigmaA * sigmaA;
  const a = (q2 * tau ** 4) / 4;
  const b = (q2 * tau ** 3) / 2;
  const c = q2 * tau * tau;
  q[N * 0 + 0] = a;
  q[N * 1 + 1] = a;
  q[N * 0 + 2] = b;
  q[N * 2 + 0] = b;
  q[N * 1 + 3] = b;
  q[N * 3 + 1] = b;
  q[N * 2 + 2] = c;
  q[N * 3 + 3] = c;
  q[N * 4 + 4] = sigmaOmega * sigmaOmega * tau;
  return q;
}

function predictModel(
  g: Gaussian,
  tau: number,
  motion: (s: Float64Array, tau: number) => Float64Array,
  q: Float64Array,
): Gaussian {
  const f = jacobian((s) => motion(s, tau), g.x);
  const p = mul(mul(f, g.p), transpose(f)).map((v, k) => v + (q[k] ?? 0));
  return { x: motion(g.x, tau), p: symmetrise(p) };
}

/** Bearing update; returns the updated estimate and the innovation's likelihood. */
function updateModel(
  g: Gaussian,
  z: number,
  ox: number,
  oy: number,
  r2: number,
): { g: Gaussian; likelihood: number } {
  const [x = 0, y = 0] = g.x;
  const dx = x - ox;
  const dy = y - oy;
  const rho2 = dx * dx + dy * dy;
  const h = [dy / rho2, -dx / rho2, 0, 0, 0];
  const ph = new Float64Array(N);
  for (let i = 0; i < N; i++)
    for (let k = 0; k < N; k++) ph[i] = (ph[i] ?? 0) + at(g.p, i, k) * (h[k] ?? 0);
  let s = r2;
  for (let k = 0; k < N; k++) s += (h[k] ?? 0) * (ph[k] ?? 0);
  const kg = ph.map((v) => v / s);
  const nu = angleDiff(z, bearingOf(dx, dy));
  const xn = g.x.map((v, i) => v + (kg[i] ?? 0) * nu);
  const ikh = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) ikh[N * i + j] = (i === j ? 1 : 0) - (kg[i] ?? 0) * (h[j] ?? 0);
  const p = mul(mul(ikh, g.p), transpose(ikh)).map(
    (v, k) => v + r2 * (kg[Math.floor(k / N)] ?? 0) * (kg[k % N] ?? 0),
  );
  const likelihood = Math.exp((-0.5 * nu * nu) / s) / Math.sqrt(2 * Math.PI * s);
  return { g: { x: xn, p: symmetrise(p) }, likelihood };
}

/** Mixture of `gs` with weights `w` (summing to 1): its mean and covariance with the spread. */
function mix(gs: readonly Gaussian[], w: readonly number[]): Gaussian {
  const x = new Float64Array(N);
  gs.forEach((g, i) => {
    for (let k = 0; k < N; k++) x[k] = (x[k] ?? 0) + (w[i] ?? 0) * (g.x[k] ?? 0);
  });
  const p = new Float64Array(N * N);
  gs.forEach((g, i) => {
    const wi = w[i] ?? 0;
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++) {
        const da = (g.x[a] ?? 0) - (x[a] ?? 0);
        const db = (g.x[b] ?? 0) - (x[b] ?? 0);
        p[N * a + b] = (p[N * a + b] ?? 0) + wi * (at(g.p, a, b) + da * db);
      }
  });
  return { x, p: symmetrise(p) };
}

/** One IMM cycle to time t, with a bearing update when `z` is not null. */
export function immStep(
  st: ImmState,
  t: number,
  z: { bearing: number; ox: number; oy: number; r2: number } | null,
  params: ImmParams,
): ImmState {
  const tau = t - st.t;
  const sw = Math.min(0.5, params.switchPerS * tau);
  const pi = [
    [1 - sw, sw],
    [sw, 1 - sw],
  ];
  const c = [0, 1].map((j) => st.mu[0] * (pi[0]?.[j] ?? 0) + st.mu[1] * (pi[1]?.[j] ?? 0));
  const mixed = [0, 1].map((j) => {
    const cj = c[j] ?? 0;
    const w = [0, 1].map((i) => ((pi[i]?.[j] ?? 0) * (st.mu[i] ?? 0)) / (cj > 0 ? cj : 1));
    return mix(st.models, w);
  });
  const [m0, m1] = mixed;
  if (m0 === undefined || m1 === undefined) throw new Error("IMM: mixing failed");
  let cv = predictModel(m0, tau, cvMotion, processNoise(tau, params.sigmaCv, 0));
  let ct = predictModel(m1, tau, ctMotion, processNoise(tau, params.sigmaCt, params.sigmaOmega));
  let like = [1, 1];
  if (z !== null) {
    const a = updateModel(cv, z.bearing, z.ox, z.oy, z.r2);
    const b = updateModel(ct, z.bearing, z.ox, z.oy, z.r2);
    cv = a.g;
    ct = b.g;
    like = [a.likelihood, b.likelihood];
  }
  let u0 = (like[0] ?? 0) * (c[0] ?? 0);
  let u1 = (like[1] ?? 0) * (c[1] ?? 0);
  const total = u0 + u1;
  if (!(total > 0) || !Number.isFinite(total)) {
    u0 = c[0] ?? 0.5;
    u1 = c[1] ?? 0.5;
  } else {
    u0 /= total;
    u1 /= total;
  }
  return { t, models: [cv, ct], mu: [u0, u1] };
}

/** The combined estimate (x, y, vx, vy, ω). */
export function immEstimate(st: ImmState): Gaussian {
  return mix(st.models, st.mu);
}

/** IMM state at sample i from the batch solution (`ekfInitialise`), ω = 0 with a wide prior. */
export function immInitialise(d: BearingData, i: number, sigma: number): ImmState | null {
  const e = ekfInitialise(d, i, sigma);
  if (e === null) return null;
  const x = new Float64Array(N);
  const p = new Float64Array(N * N);
  for (let a = 0; a < 4; a++) {
    x[a] = e.x[a] ?? 0;
    for (let b = 0; b < 4; b++) p[N * a + b] = e.p[4 * a + b] ?? 0;
  }
  p[N * 4 + 4] = IMM_OMEGA0_SD * IMM_OMEGA0_SD;
  const g = (): Gaussian => ({ x: Float64Array.from(x), p: Float64Array.from(p) });
  return { t: e.t, models: [g(), g()], mu: [IMM_MU0[0], IMM_MU0[1]] };
}

function plausible(d: BearingData, x: Float64Array, i: number): boolean {
  const [px = NaN, py = NaN, vx = NaN, vy = NaN, w = NaN] = x;
  const range = Math.hypot(px - (d.ownX[i] ?? 0), py - (d.ownY[i] ?? 0));
  return (
    [px, py, vx, vy, w].every(Number.isFinite) &&
    Math.hypot(vx, vy) <= PLAUSIBLE.maxSpeedMps &&
    range > 0 &&
    range <= PLAUSIBLE.maxRangeM
  );
}

function row(d: BearingData, x: Float64Array, i: number, converged: boolean): PredictionRow {
  const [px = 0, py = 0, vx = 0, vy = 0] = x;
  return {
    timestamp_s: f32(d.t[i] ?? 0),
    range_m: converged ? f32(Math.hypot(px - (d.ownX[i] ?? 0), py - (d.ownY[i] ?? 0))) : 0,
    course_rad: converged ? f32Angle(bearingOf(vx, vy)) : 0,
    speed_mps: converged ? f32(Math.hypot(vx, vy)) : 0,
    x_m: converged ? f32(px) : 0,
    y_m: converged ? f32(py) : 0,
    converged,
    iterations: 0,
  };
}

/**
 * IMM estimate for one scenario: one row per sample from zig_index + 1 to the end, as the
 * classical per-timestep mode and `ekfPredict`, each using only bearings up to that sample. An
 * implausible combined estimate is reported non-converged and the tracker re-initialises from the
 * batch solution, at once and then every `EKF_REINIT_EVERY` samples until it succeeds.
 */
export function immPredict(s: Scenario, params: ImmParams): Prediction {
  for (const [k, v] of Object.entries(params))
    if (!(typeof v === "number" && v >= 0)) throw new Error(`IMM ${k} must be ≥ 0`);
  const d = bearingData(s);
  const n = s.metadata.samples;
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2;
  const rows: PredictionRow[] = [];
  const first = s.metadata.zig_index + 1;
  let st = first - 1 < n ? immInitialise(d, first - 1, sigma) : null;
  let lastTry = first - 1;
  for (let i = first; i < n; i++) {
    if (st !== null) {
      const z =
        d.valid[i] === 1
          ? { bearing: d.bearing[i] ?? 0, ox: d.ownX[i] ?? 0, oy: d.ownY[i] ?? 0, r2 }
          : null;
      st = immStep(st, d.t[i] ?? 0, z, params);
      const est = immEstimate(st).x;
      if (plausible(d, est, i)) {
        rows.push(row(d, est, i, true));
        continue;
      }
      st = null;
      lastTry = i - EKF_REINIT_EVERY;
    }
    rows.push(row(d, new Float64Array(N), i, false));
    if (i - lastTry >= EKF_REINIT_EVERY) {
      st = immInitialise(d, i, sigma);
      lastTry = i;
    }
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: immName(params),
    mode: "per_timestep",
    rows,
  };
}
