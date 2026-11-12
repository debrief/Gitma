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
import {
  EKF_MIN_SIGMA_RAD,
  EKF_REINIT_EVERY,
  type GuardedInit,
  initialiseAt,
  scaleSuffix,
} from "./ekf.js";
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
  /** Scale on the initial covariance (default 1). */
  p0Scale?: number;
  /** Scale on the measurement variance (default 1). */
  rScale?: number;
  /** Initialisation (spec 016; default 0, every frozen reference): see `GuardedInit`. */
  guardedInit?: GuardedInit;
  /**
   * Write each row's stated standard deviations (spec 018; name suffix `-sd`): log-range, course
   * and speed from the combined covariance by the delta method. The estimates are unchanged.
   */
  reportSd?: boolean;
  /**
   * Bearing-bias state (spec 021, phase 9; name suffix `-b<sd>-tb<τ>`): a sixth state b, a
   * Gauss–Markov bias with stationary sd `biasSdDeg` (degrees) and time constant `biasTauS` (s),
   * added to the predicted bearing. Both or neither; absent, the filter is the 5-state IMM, unchanged.
   */
  biasSdDeg?: number;
  biasTauS?: number;
}

/** Whether `p` declares the bearing-bias state (spec 021). */
export const hasBias = (p: ImmParams): boolean =>
  p.biasSdDeg !== undefined && p.biasTauS !== undefined;

/** Estimator name of the IMM with `p`. */
export const immName = (p: ImmParams): string =>
  `${IMM}-cv${String(p.sigmaCv)}-ct${String(p.sigmaCt)}-w${String(p.sigmaOmega)}-s${String(p.switchPerS)}${scaleSuffix(p)}${hasBias(p) ? `-b${String(p.biasSdDeg)}-tb${String(p.biasTauS)}` : ""}${p.reportSd === true ? "-sd" : ""}`;

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
  /**
   * Normalised innovation squared of the last update, ν²/S averaged over the models with their
   * predicted probabilities (null without a bearing). About 1 on average when the measurement
   * variance and the motion models are right (a consistency check, G0 phase 4).
   */
  nis?: number | null;
  /**
   * Signed normalised innovation of the last update, ν/√S averaged over the models with their
   * predicted probabilities (null without a bearing; spec 017's mean-shift CUSUM). It does not
   * feed back into the filter, so the rows are unchanged.
   */
  innovation?: number | null;
}

/** State dimension of a covariance (n × n, stored row-major). */
const dimOf = (p: Float64Array): number => Math.round(Math.sqrt(p.length));

const at = (a: Float64Array, i: number, j: number, n = dimOf(a)): number => a[n * i + j] ?? 0;

function mul(a: Float64Array, b: Float64Array): Float64Array {
  const n = dimOf(a);
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += at(a, i, k, n) * at(b, k, j, n);
      c[n * i + j] = s;
    }
  return c;
}

const transpose = (a: Float64Array): Float64Array => {
  const n = dimOf(a);
  return Float64Array.from({ length: n * n }, (_, k) => at(a, k % n, Math.floor(k / n), n));
};

function symmetrise(p: Float64Array): Float64Array {
  const n = dimOf(p);
  const s = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) s[n * i + j] = (at(p, i, j, n) + at(p, j, i, n)) / 2;
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
  const n = s.length;
  const j = new Float64Array(n * n);
  for (let c = 0; c < n; c++) {
    const h = c === 4 ? 1e-7 : 1e-4 * Math.max(1, Math.abs(s[c] ?? 0));
    const up = Float64Array.from(s);
    const dn = Float64Array.from(s);
    up[c] = (up[c] ?? 0) + h;
    dn[c] = (dn[c] ?? 0) - h;
    const fu = f(up);
    const fd = f(dn);
    for (let r = 0; r < n; r++) j[n * r + c] = ((fu[r] ?? 0) - (fd[r] ?? 0)) / (2 * h);
  }
  return j;
}

/** White-noise acceleration over τ on (x, y, vx, vy), plus σ_ω²τ on ω. */
function processNoise(
  tau: number,
  sigmaA: number,
  sigmaOmega: number,
  n = N,
  bias?: { sd: number; tau: number },
): Float64Array {
  const q = new Float64Array(n * n);
  const q2 = sigmaA * sigmaA;
  const a = (q2 * tau ** 4) / 4;
  const b = (q2 * tau ** 3) / 2;
  const c = q2 * tau * tau;
  q[n * 0 + 0] = a;
  q[n * 1 + 1] = a;
  q[n * 0 + 2] = b;
  q[n * 2 + 0] = b;
  q[n * 1 + 3] = b;
  q[n * 3 + 1] = b;
  q[n * 2 + 2] = c;
  q[n * 3 + 3] = c;
  q[n * 4 + 4] = sigmaOmega * sigmaOmega * tau;
  // The bias's discrete Gauss–Markov noise keeps its variance stationary: sd²(1 − e^(−2τ/τ_b)).
  if (bias !== undefined && n > N)
    q[n * N + N] = bias.sd * bias.sd * (1 - Math.exp((-2 * tau) / bias.tau));
  return q;
}

function predictModel(
  g: Gaussian,
  tau: number,
  motion: (s: Float64Array, tau: number) => Float64Array,
  q: Float64Array,
  biasTau?: number,
): Gaussian {
  // With a bias state (spec 021), the motion acts on the first five states and the bias decays.
  const full =
    g.x.length > N && biasTau !== undefined
      ? (s: Float64Array): Float64Array => {
          const out = new Float64Array(N + 1);
          out.set(motion(s.subarray(0, N), tau));
          out[N] = (s[N] ?? 0) * Math.exp(-tau / biasTau);
          return out;
        }
      : (s: Float64Array): Float64Array => motion(s, tau);
  const f = jacobian(full, g.x);
  const p = mul(mul(f, g.p), transpose(f)).map((v, k) => v + (q[k] ?? 0));
  return { x: full(g.x), p: symmetrise(p) };
}

/** Bearing update; returns the updated estimate and the innovation's likelihood. */
function updateModel(
  g: Gaussian,
  z: number,
  ox: number,
  oy: number,
  r2: number,
): { g: Gaussian; likelihood: number; nis: number; innovation: number } {
  const [x = 0, y = 0] = g.x;
  const dx = x - ox;
  const dy = y - oy;
  const rho2 = dx * dx + dy * dy;
  const n = g.x.length;
  // With a bias state (spec 021) the predicted bearing is bearingOf(dx, dy) + b, so H has a 1 there.
  const h = n > N ? [dy / rho2, -dx / rho2, 0, 0, 0, 1] : [dy / rho2, -dx / rho2, 0, 0, 0];
  const ph = new Float64Array(n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) ph[i] = (ph[i] ?? 0) + at(g.p, i, k, n) * (h[k] ?? 0);
  let s = r2;
  for (let k = 0; k < n; k++) s += (h[k] ?? 0) * (ph[k] ?? 0);
  const kg = ph.map((v) => v / s);
  const nu = angleDiff(z, bearingOf(dx, dy) + (n > N ? (g.x[N] ?? 0) : 0));
  const xn = g.x.map((v, i) => v + (kg[i] ?? 0) * nu);
  const ikh = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) ikh[n * i + j] = (i === j ? 1 : 0) - (kg[i] ?? 0) * (h[j] ?? 0);
  const p = mul(mul(ikh, g.p), transpose(ikh)).map(
    (v, k) => v + r2 * (kg[Math.floor(k / n)] ?? 0) * (kg[k % n] ?? 0),
  );
  const likelihood = Math.exp((-0.5 * nu * nu) / s) / Math.sqrt(2 * Math.PI * s);
  return {
    g: { x: xn, p: symmetrise(p) },
    likelihood,
    nis: (nu * nu) / s,
    innovation: nu / Math.sqrt(s),
  };
}

/** Mixture of `gs` with weights `w` (summing to 1): its mean and covariance with the spread. */
function mix(gs: readonly Gaussian[], w: readonly number[]): Gaussian {
  const n = gs[0]?.x.length ?? N;
  const x = new Float64Array(n);
  gs.forEach((g, i) => {
    for (let k = 0; k < n; k++) x[k] = (x[k] ?? 0) + (w[i] ?? 0) * (g.x[k] ?? 0);
  });
  const p = new Float64Array(n * n);
  gs.forEach((g, i) => {
    const wi = w[i] ?? 0;
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        const da = (g.x[a] ?? 0) - (x[a] ?? 0);
        const db = (g.x[b] ?? 0) - (x[b] ?? 0);
        p[n * a + b] = (p[n * a + b] ?? 0) + wi * (at(g.p, a, b, n) + da * db);
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
  const n = m0.x.length;
  const bias =
    n > N && hasBias(params)
      ? { sd: ((params.biasSdDeg ?? 0) * Math.PI) / 180, tau: params.biasTauS ?? 1 }
      : undefined;
  let cv = predictModel(
    m0,
    tau,
    cvMotion,
    processNoise(tau, params.sigmaCv, 0, n, bias),
    bias?.tau,
  );
  let ct = predictModel(
    m1,
    tau,
    ctMotion,
    processNoise(tau, params.sigmaCt, params.sigmaOmega, n, bias),
    bias?.tau,
  );
  let like = [1, 1];
  let nis: number | null = null;
  let innovation: number | null = null;
  if (z !== null) {
    const a = updateModel(cv, z.bearing, z.ox, z.oy, z.r2);
    const b = updateModel(ct, z.bearing, z.ox, z.oy, z.r2);
    cv = a.g;
    ct = b.g;
    like = [a.likelihood, b.likelihood];
    nis = (c[0] ?? 0) * a.nis + (c[1] ?? 0) * b.nis;
    innovation = (c[0] ?? 0) * a.innovation + (c[1] ?? 0) * b.innovation;
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
  return { t, models: [cv, ct], mu: [u0, u1], nis, innovation };
}

/**
 * Log-range update of every model (phase 4c, spec 014): a range measurement `range` with a
 * log-range standard deviation `sdLog`, z = ln(range), h(x) = ln ρ, H = [dx/ρ², dy/ρ², 0, 0, 0],
 * R = sdLog², Joseph form. Model probabilities are left to the bearings. Returns the new state and
 * the innovation's ν²/S averaged over the models.
 */
export function immRangeUpdate(
  st: ImmState,
  range: number,
  sdLog: number,
  ox: number,
  oy: number,
): { st: ImmState; nis: number } {
  const r2 = sdLog * sdLog;
  const z = Math.log(range);
  let nis = 0;
  const models = st.models.map((g): Gaussian => {
    const dx = (g.x[0] ?? 0) - ox;
    const dy = (g.x[1] ?? 0) - oy;
    const rho2 = dx * dx + dy * dy;
    const n = g.x.length;
    const h = [dx / rho2, dy / rho2, 0, 0, 0, 0];
    const ph = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 2; k++) ph[i] = (ph[i] ?? 0) + at(g.p, i, k, n) * (h[k] ?? 0);
    const s = r2 + (h[0] ?? 0) * (ph[0] ?? 0) + (h[1] ?? 0) * (ph[1] ?? 0);
    const kg = ph.map((v) => v / s);
    const nu = z - 0.5 * Math.log(rho2);
    nis += (nu * nu) / s / st.models.length;
    const xn = g.x.map((v, i) => v + (kg[i] ?? 0) * nu);
    const ikh = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) ikh[n * i + j] = (i === j ? 1 : 0) - (kg[i] ?? 0) * (h[j] ?? 0);
    const p = mul(mul(ikh, g.p), transpose(ikh)).map(
      (v, k) => v + r2 * (kg[Math.floor(k / n)] ?? 0) * (kg[k % n] ?? 0),
    );
    return { x: xn, p: symmetrise(p) };
  }) as [Gaussian, Gaussian];
  return { st: { ...st, models }, nis };
}

/** The combined estimate (x, y, vx, vy, ω). */
export function immEstimate(st: ImmState): Gaussian {
  return mix(st.models, st.mu);
}

/**
 * IMM state at sample i from the batch solution, ω = 0 with a wide prior. `level` and `reinit`
 * select the initialiser (`initialiseAt`, spec 016); the defaults are `ekfInitialise`, unchanged.
 */
export function immInitialise(
  d: BearingData,
  i: number,
  sigma: number,
  p0Scale = 1,
  level: GuardedInit = 0,
  reinit = false,
  biasSdRad?: number,
): ImmState | null {
  const e = initialiseAt(d, i, sigma, p0Scale, level, reinit);
  if (e === null) return null;
  // With a bias state (spec 021): b = 0 with its stationary variance, uncorrelated at the start.
  const n = biasSdRad === undefined ? N : N + 1;
  const x = new Float64Array(n);
  const p = new Float64Array(n * n);
  for (let a = 0; a < 4; a++) {
    x[a] = e.x[a] ?? 0;
    for (let b = 0; b < 4; b++) p[n * a + b] = e.p[4 * a + b] ?? 0;
  }
  p[n * 4 + 4] = IMM_OMEGA0_SD * IMM_OMEGA0_SD;
  if (biasSdRad !== undefined) p[n * N + N] = biasSdRad * biasSdRad;
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

/**
 * Stated standard deviations of log-range, course and speed at sample i from the combined
 * estimate's covariance `p` (5×5), by the delta method: ∇ln ρ = (dx, dy)/ρ², ∇θ = (vy, −vx)/v²
 * (θ = atan2(vx, vy)), ∇v = (vx, vy)/v. Null where a gradient is undefined (ρ or v zero) or the
 * variance is not positive.
 */
export function stateSds(
  x: Float64Array,
  p: Float64Array,
  ox: number,
  oy: number,
): { log_range_sd: number; course_sd_rad: number; speed_sd_mps: number } | null {
  const [px = 0, py = 0, vx = 0, vy = 0] = x;
  const dx = px - ox;
  const dy = py - oy;
  const r2 = dx * dx + dy * dy;
  const v2 = vx * vx + vy * vy;
  if (!(r2 > 0) || !(v2 > 0)) return null;
  const quad = (g: number[], off: number): number => {
    let s = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++) s += (g[a] ?? 0) * at(p, off + a, off + b) * (g[b] ?? 0);
    return s;
  };
  const lr = quad([dx / r2, dy / r2], 0);
  const th = quad([vy / v2, -vx / v2], 2);
  const sp = quad([vx / Math.sqrt(v2), vy / Math.sqrt(v2)], 2);
  if (!(lr > 0) || !(th > 0) || !(sp > 0)) return null;
  return {
    log_range_sd: f32(Math.sqrt(lr)),
    course_sd_rad: f32(Math.sqrt(th)),
    speed_sd_mps: f32(Math.sqrt(sp)),
  };
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
 * `onStep`, if given, sees the state after each update (G0's NIS check reads it there, so it tests
 * this code path, measurement variance and scales included). `extra`, if given, applies further
 * measurements after the bearing update at sample i (the fused tracker's range, spec 014).
 */
export function immPredict(
  s: Scenario,
  params: ImmParams,
  onStep?: (i: number, st: ImmState) => void,
  extra?: (i: number, st: ImmState) => ImmState,
): Prediction {
  for (const [k, v] of Object.entries(params))
    if (k !== "reportSd" && !(typeof v === "number" && v >= 0))
      throw new Error(`IMM ${k} must be ≥ 0`);
  if ((params.biasSdDeg === undefined) !== (params.biasTauS === undefined))
    throw new Error("IMM biasSdDeg and biasTauS go together");
  if (params.biasTauS !== undefined && !(params.biasTauS > 0))
    throw new Error("IMM biasTauS must be > 0");
  const biasSdRad = hasBias(params) ? ((params.biasSdDeg ?? 0) * Math.PI) / 180 : undefined;
  if (params.p0Scale === 0 || params.rScale === 0) throw new Error("IMM scales must be > 0");
  const level = params.guardedInit ?? 0;
  if (![0, 1, 2].includes(level)) throw new Error("IMM guardedInit must be 0, 1 or 2");
  const d = bearingData(s);
  const n = s.metadata.samples;
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const p0Scale = params.p0Scale ?? 1;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2 * (params.rScale ?? 1);
  const rows: PredictionRow[] = [];
  const first = s.metadata.zig_index + 1;
  let st =
    first - 1 < n ? immInitialise(d, first - 1, sigma, p0Scale, level, false, biasSdRad) : null;
  let lastTry = first - 1;
  for (let i = first; i < n; i++) {
    if (st !== null) {
      const z =
        d.valid[i] === 1
          ? { bearing: d.bearing[i] ?? 0, ox: d.ownX[i] ?? 0, oy: d.ownY[i] ?? 0, r2 }
          : null;
      st = immStep(st, d.t[i] ?? 0, z, params);
      if (extra !== undefined) st = extra(i, st);
      onStep?.(i, st);
      const combined = immEstimate(st);
      const est = combined.x;
      if (plausible(d, est, i)) {
        const r = row(d, est, i, true);
        if (params.reportSd === true) {
          const sd = stateSds(est, combined.p, d.ownX[i] ?? 0, d.ownY[i] ?? 0);
          rows.push(sd === null ? r : { ...r, ...sd });
        } else rows.push(r);
        continue;
      }
      st = null;
      lastTry = i - EKF_REINIT_EVERY;
    }
    rows.push(row(d, new Float64Array(N), i, false));
    if (i - lastTry >= EKF_REINIT_EVERY) {
      st = immInitialise(d, i, sigma, p0Scale, level, true, biasSdRad);
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
