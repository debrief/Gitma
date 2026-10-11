// Batch least-squares bearings-only solver (research R5): Levenberg–Marquardt-damped Gauss–Newton
// on the target state θ = (x0, y0, vx, vy) at window start, constant-velocity model.
// Pure functions over typed arrays; the only state is what callers pass in.
import { angleDiff, bearingOf, TWO_PI } from "@tma/sim";

/** Inputs for one scenario as flat arrays (one entry per sample). */
export interface BearingData {
  t: Float64Array;
  ownX: Float64Array;
  ownY: Float64Array;
  bearing: Float64Array;
  valid: Uint8Array;
}

export interface Solution {
  /** [x0, y0, vx, vy] at t = 0. */
  theta: Float64Array;
  converged: boolean;
  iterations: number;
  cost: number;
}

export interface SolveOptions {
  maxIterations: number;
}

export const DEFAULT_SOLVE_OPTIONS: SolveOptions = { maxIterations: 50 };

const LAMBDA0 = 1e-3;
const LAMBDA_MAX = 1e12;

/** Sum of squared wrapped bearing residuals over valid samples [0, upto). */
export function cost(d: BearingData, th: Float64Array, upto: number): number {
  let c = 0;
  const [x0 = 0, y0 = 0, vx = 0, vy = 0] = th;
  for (let i = 0; i < upto; i++) {
    if (d.valid[i] !== 1) continue;
    const t = d.t[i] ?? 0;
    const h = bearingOf(x0 + vx * t - (d.ownX[i] ?? 0), y0 + vy * t - (d.ownY[i] ?? 0));
    const r = angleDiff(d.bearing[i] ?? 0, h);
    c += r * r;
  }
  return c;
}

/** Normal equations JᵀJ (4×4, row-major) and Jᵀr for residuals r = z − h. */
export function normalEquations(
  d: BearingData,
  th: Float64Array,
  upto: number,
): { jtj: Float64Array; jtr: Float64Array } {
  const jtj = new Float64Array(16);
  const jtr = new Float64Array(4);
  const [x0 = 0, y0 = 0, vx = 0, vy = 0] = th;
  const g = new Float64Array(4);
  for (let i = 0; i < upto; i++) {
    if (d.valid[i] !== 1) continue;
    const t = d.t[i] ?? 0;
    const dx = x0 + vx * t - (d.ownX[i] ?? 0);
    const dy = y0 + vy * t - (d.ownY[i] ?? 0);
    const rho2 = dx * dx + dy * dy;
    // h = atan2(dx, dy): ∂h/∂dx = dy/ρ², ∂h/∂dy = −dx/ρ².
    g[0] = dy / rho2;
    g[1] = -dx / rho2;
    g[2] = t * g[0];
    g[3] = t * g[1];
    const r = angleDiff(d.bearing[i] ?? 0, bearingOf(dx, dy));
    for (let a = 0; a < 4; a++) {
      const ga = g[a] ?? 0;
      jtr[a] = (jtr[a] ?? 0) + ga * r;
      for (let b = 0; b < 4; b++) jtj[4 * a + b] = (jtj[4 * a + b] ?? 0) + ga * (g[b] ?? 0);
    }
  }
  return { jtj, jtr };
}

/** Solve the 4×4 system A x = b by Gaussian elimination with partial pivoting; null if singular. */
export function solve4(a: Float64Array, b: Float64Array): Float64Array | null {
  const m = Float64Array.from(a);
  const x = Float64Array.from(b);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) {
      if (Math.abs(m[4 * r + c] ?? 0) > Math.abs(m[4 * p + c] ?? 0)) p = r;
    }
    const pivot = m[4 * p + c] ?? 0;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-300) return null;
    if (p !== c) {
      for (let k = 0; k < 4; k++) {
        const tmp = m[4 * c + k] ?? 0;
        m[4 * c + k] = m[4 * p + k] ?? 0;
        m[4 * p + k] = tmp;
      }
      const tb = x[c] ?? 0;
      x[c] = x[p] ?? 0;
      x[p] = tb;
    }
    for (let r = c + 1; r < 4; r++) {
      const f = (m[4 * r + c] ?? 0) / pivot;
      for (let k = c; k < 4; k++) m[4 * r + k] = (m[4 * r + k] ?? 0) - f * (m[4 * c + k] ?? 0);
      x[r] = (x[r] ?? 0) - f * (x[c] ?? 0);
    }
  }
  for (let r = 3; r >= 0; r--) {
    let s = x[r] ?? 0;
    for (let k = r + 1; k < 4; k++) s -= (m[4 * r + k] ?? 0) * (x[k] ?? 0);
    x[r] = s / (m[4 * r + r] ?? 1);
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Levenberg–Marquardt from `start`, using valid samples [0, upto).
 * Converged when an accepted step changes the cost by ≤ 1e-12 relative (or the cost is ~0), or
 * when no damping can reduce the cost further (a stationary point).
 */
export function levenbergMarquardt(
  d: BearingData,
  start: Float64Array,
  upto: number,
  opts: SolveOptions = DEFAULT_SOLVE_OPTIONS,
): Solution {
  let th = Float64Array.from(start);
  let c = cost(d, th, upto);
  let lambda = LAMBDA0;
  for (let it = 1; it <= opts.maxIterations; it++) {
    const { jtj, jtr } = normalEquations(d, th, upto);
    let accepted = false;
    while (lambda <= LAMBDA_MAX) {
      const damped = Float64Array.from(jtj);
      for (let k = 0; k < 4; k++) damped[5 * k] = (jtj[5 * k] ?? 0) * (1 + lambda);
      const step = solve4(damped, jtr);
      if (step !== null) {
        const next = th.map((v, k) => v + (step[k] ?? 0));
        const cn = cost(d, next, upto);
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
  return { theta: th, converged: false, iterations: opts.maxIterations, cost: c };
}

/** First valid sample index below `upto`, or −1. */
function firstValid(d: BearingData, upto: number): number {
  for (let i = 0; i < upto; i++) if (d.valid[i] === 1) return i;
  return -1;
}

/**
 * Coarse grid start (research R5): 12 log-spaced ranges 1–40 km along the first valid bearing ×
 * 8 target courses × 3 speeds; returns the lowest-cost state.
 */
export function gridStart(d: BearingData, upto: number): Float64Array | null {
  const i0 = firstValid(d, upto);
  if (i0 < 0) return null;
  const t0 = d.t[i0] ?? 0;
  const b0 = d.bearing[i0] ?? 0;
  let best: Float64Array | null = null;
  let bestCost = Infinity;
  const th = new Float64Array(4);
  for (let ri = 0; ri < 12; ri++) {
    const r = 1000 * Math.pow(40, ri / 11);
    const px = (d.ownX[i0] ?? 0) + r * Math.sin(b0);
    const py = (d.ownY[i0] ?? 0) + r * Math.cos(b0);
    for (let ci = 0; ci < 8; ci++) {
      const course = (ci * TWO_PI) / 8;
      for (const speed of [2, 5, 9]) {
        const vx = speed * Math.sin(course);
        const vy = speed * Math.cos(course);
        th[0] = px - vx * t0;
        th[1] = py - vy * t0;
        th[2] = vx;
        th[3] = vy;
        const c = cost(d, th, upto);
        if (c < bestCost) {
          bestCost = c;
          best = Float64Array.from(th);
        }
      }
    }
  }
  return best;
}

/** Solve using all samples [0, upto) from a grid start. */
export function solveBatch(
  d: BearingData,
  upto: number,
  opts: SolveOptions = DEFAULT_SOLVE_OPTIONS,
): Solution | null {
  const start = gridStart(d, upto);
  return start === null ? null : levenbergMarquardt(d, start, upto, opts);
}
