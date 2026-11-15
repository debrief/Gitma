// Spec 024 (research; no gate): Cramér–Rao bounds on range, course and speed at the G5 rows, under
// the generator's exact bearing-error covariance (white + Gauss–Markov + drifting bias), or white
// noise only (--clean). The unknowns are offsets (δp, δv) to the true target track; on rows before
// any manoeuvre that is the constant-velocity model exactly, after one it is a genie bound (the
// manoeuvre's shape known). Beside each slice's bound: the median errors of the given prediction
// files and of batch least squares (solveBatch, as spec014-lsq.mjs) on the same rows.
//
//   pnpm build
//   node scripts/research/spec024-crb.mjs <truth.f32pack> <ranges.json|--clean> <out.json> \
//     <label>=<pred.ndjson>...
import { readFileSync, writeFileSync } from "node:fs";
import { bearingData, plausible, rowAt, solveBatch } from "../../packages/classical/dist/index.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truthPath, model, outPath, ...predArgs] = process.argv.slice(2);
if (outPath === undefined) {
  console.error(
    "usage: spec024-crb.mjs <truth> <ranges.json|--clean> <out.json> <label>=<pred>...",
  );
  process.exit(2);
}
const be = model === "--clean" ? null : JSON.parse(readFileSync(model, "utf8")).bearing_error;
if (model !== "--clean" && be == null) throw new Error(`${model}: no bearing_error`);
const preds = predArgs.map((a) => {
  const i = a.indexOf("=");
  return { label: a.slice(0, i), set: openPredictionSet(a.slice(i + 1), truthPath) };
});
const KT = 1.943844;
const DEG = 180 / Math.PI;
const wrap = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

/** Error covariance between samples i and j (seconds apart: |i − j|·dt). */
function cov(sigma, lag, dt) {
  let c = lag === 0 ? sigma * sigma : 0;
  if (be != null) {
    c += be.ar_sd_rad ** 2 * Math.exp((-lag * dt) / be.ar_tau_s);
    c += be.bias_sd_rad ** 2 * Math.exp((-lag * dt) / be.bias_tau_s);
  }
  return c;
}

/** Inverse of a symmetric 4×4 (Gauss–Jordan); null if singular. */
function inv4(a) {
  const m = a.map((r, i) => [...r, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-300) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 8; j++) m[c][j] /= d;
    for (let r = 0; r < 4; r++)
      if (r !== c) {
        const f = m[r][c];
        for (let j = 0; j < 8; j++) m[r][j] -= f * m[c][j];
      }
  }
  return m.map((r) => r.slice(4));
}

/**
 * Per G5 row of scenario s: the CRB sds of relative range, course (deg) and speed (kt) at row k, or
 * null where the information matrix is singular. One Cholesky of Σ over the valid samples up to the
 * last row; a prefix of L⁻¹H gives the information of every earlier row.
 */
function bounds(s, ks) {
  const p = s.metadata.parameters;
  const dt = p.dt_s;
  const kmax = Math.max(...ks);
  const idx = [];
  for (let i = 0; i <= kmax; i++) if (s.observations[i].valid) idx.push(i);
  const n = idx.length;
  // H in θ0 = (δx, δy, δvx, δvy) referred to t = 0.
  const H = idx.map((i) => {
    const o = s.ownship.states[i];
    const t = s.target.states[i];
    const dx = t.x_m - o.x_m;
    const dy = t.y_m - o.y_m;
    const r2 = dx * dx + dy * dy;
    const gx = dy / r2;
    const gy = -dx / r2;
    const ti = i * dt;
    return [gx, gy, gx * ti, gy * ti];
  });
  // Cholesky of Σ (n×n) and W = L⁻¹H, row by row.
  const L = new Float64Array(n * n);
  const W = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b <= a; b++) {
      let sum = cov(p.noise_sigma_rad, Math.abs(idx[a] - idx[b]), dt);
      for (let c = 0; c < b; c++) sum -= L[a * n + c] * L[b * n + c];
      if (a === b) {
        if (sum <= 0) throw new Error(`scenario ${s.metadata.index}: Σ not positive definite`);
        L[a * n + a] = Math.sqrt(sum);
      } else L[a * n + b] = sum / L[b * n + b];
    }
    const w = H[a].slice();
    for (let c = 0; c < a; c++) for (let j = 0; j < 4; j++) w[j] -= L[a * n + c] * W[c][j];
    for (let j = 0; j < 4; j++) w[j] /= L[a * n + a];
    W.push(w);
  }
  const out = new Map();
  const J = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  let a = 0;
  for (const k of [...ks].sort((x, y) => x - y)) {
    for (; a < n && idx[a] <= k; a++)
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) J[i][j] += W[a][i] * W[a][j];
    const C0 = inv4(J);
    if (C0 === null) {
      out.set(k, null);
      continue;
    }
    // Carry to t_k: δp_k = δp0 + δv·t_k.
    const tk = k * dt;
    const T = [
      [1, 0, tk, 0],
      [0, 1, 0, tk],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const C = T.map((ti) =>
      T.map((tj) => {
        let v = 0;
        for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) v += ti[x] * C0[x][y] * tj[y];
        return v;
      }),
    );
    const o = s.ownship.states[k];
    const t = s.target.states[k];
    const dx = t.x_m - o.x_m;
    const dy = t.y_m - o.y_m;
    const r = Math.hypot(dx, dy);
    const vx = t.speed_mps * Math.sin(t.course_rad);
    const vy = t.speed_mps * Math.cos(t.course_rad);
    const sp = Math.hypot(vx, vy);
    const quad = (g) => {
      let v = 0;
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) v += g[x] * C[x][y] * g[y];
      return Math.sqrt(Math.max(v, 0));
    };
    out.set(k, [
      quad([dx / r, dy / r, 0, 0]) / r,
      quad([0, 0, vy / (sp * sp), -vx / (sp * sp)]) * DEG,
      quad([0, 0, vx / sp, vy / sp]) * KT,
    ]);
  }
  return out;
}

// erf (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7).
function erf(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return y;
}
/** Median of |e| when e ~ N(0, sᵢ²) with each row equally likely (bisection). */
function mixtureMedian(sds) {
  let lo = 0;
  let hi = 10 * Math.max(...sds);
  for (let it = 0; it < 100; it++) {
    const m = (lo + hi) / 2;
    let f = 0;
    for (const sd of sds) f += sd > 0 ? erf(m / (sd * Math.SQRT2)) : 1;
    if (f / sds.length < 0.5) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
const median = (xs) => {
  const b = Float64Array.from(xs).sort();
  return b[Math.floor((b.length - 1) / 2)];
};

const rows = [];
let singular = 0;
for (const s of scenarioSource(truthPath)) {
  const rs = g5Rows([s]);
  if (rs.length === 0) continue;
  const b = bounds(
    s,
    rs.map((r) => r.k),
  );
  const d = bearingData(s);
  const dt = s.metadata.parameters.dt_s;
  const after = (k) => (s.metadata.manoeuvres ?? []).some((m) => m.end_index <= k);
  for (const r of rs) {
    const bound = b.get(r.k);
    if (bound === null) {
      singular++;
      continue;
    }
    const e = {};
    for (const { label, set } of preds) {
      const p = set.byIndex.get(s.metadata.index);
      if (p === undefined) throw new Error(`${label}: no prediction for ${s.metadata.index}`);
      const row = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
      const re = row === undefined || !row.converged ? null : rowError(s, row);
      e[label] =
        re === null ? [Infinity, Infinity, Infinity] : [re.range_rel, re.course_deg, re.speed_kt];
    }
    const sol = solveBatch(d, r.k + 1);
    const o = s.ownship.states[r.k];
    const t = s.target.states[r.k];
    const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
    e.lsq = [Infinity, Infinity, Infinity];
    if (sol !== null && plausible(d, sol, r.k)) {
      const q = rowAt(d, sol, r.k);
      e.lsq = [
        Math.abs(q.range_m - range) / range,
        wrap(q.course_rad - t.course_rad) * DEG,
        Math.abs(q.speed_mps - t.speed_mps) * KT,
      ];
    }
    rows.push({ settled: r.settled, after: after(r.k), bound, e });
  }
}

const SLICES = {
  all: () => true,
  "settled, before any manoeuvre (exact CV bound)": (r) => r.settled && !r.after,
  "after a manoeuvre (genie bound)": (r) => r.after,
};
const METRICS = ["range_rel", "course_deg", "speed_kt"];
const out = {
  truth: truthPath,
  error_model: be ?? "white noise only",
  rows: rows.length,
  singular_rows: singular,
  slices: {},
};
for (const [name, f] of Object.entries(SLICES)) {
  const sub = rows.filter(f);
  const sl = { n: sub.length, bound_median: {}, bound_sd_median: {}, estimators: {} };
  METRICS.forEach((m, j) => {
    sl.bound_median[m] = mixtureMedian(sub.map((r) => r.bound[j]));
    sl.bound_sd_median[m] = median(sub.map((r) => r.bound[j]));
  });
  for (const label of [...preds.map((p) => p.label), "lsq"]) {
    const est = {};
    METRICS.forEach((m, j) => {
      const med = median(sub.map((r) => r.e[label][j]));
      est[m] = { median: med, ratio_to_bound: med / sl.bound_median[m] };
    });
    sl.estimators[label] = est;
  }
  out.slices[name] = sl;
}
console.log(JSON.stringify(out.slices, null, 1).slice(0, 4000));
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
