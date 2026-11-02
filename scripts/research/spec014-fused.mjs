// Research after phase 4b (validation only; nothing here is gated): a fused tracker. The frozen
// reference IMM (decision 29) gains a second measurement, T2's range, as a log-range update with
// T2's own stated sd (log_range_sd) times an inflation k, applied every M samples. One state
// carries range and velocity, unlike the phase-4b hybrid (T2's range with the IMM's velocity).
//   z = ln(range_T2),  h(x) = ln ρ,  H = [dx/ρ², dy/ρ², 0, 0, 0],  R = (k · log_range_sd)²
// The update is applied to both models after the bearing update; model probabilities are left to
// the bearings. k inflates T2's variance because its errors are correlated in time and with the
// bearings the IMM already uses; M thins the updates for the same reason.
//
// Scored as G5 would on the G5 rows (median errors; non-converged = infinite): overall, settled,
// settled before / after any manoeuvre, not settled; beside the plain IMM (variant "0:0", which
// must reproduce val.imm.ndjson), T2 alone and the phase-4b hybrid (θ = 45°), all on the same rows.
// Also the range update's mean NIS (ν²/S; about 1 if R is right).
//
//   pnpm build
//   node scripts/research/spec014-fused.mjs <truth.f32pack> <t2.ndjson> <out.json> <k:M>...
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  bearingData,
  EKF_MIN_SIGMA_RAD,
  EKF_REINIT_EVERY,
  immEstimate,
  immInitialise,
  immStep,
  PLAUSIBLE,
  trackerHybridRow,
} from "../../packages/classical/dist/index.js";
import { g5Rows, scenarioSource } from "../../packages/eval/dist/index.js";

const [truthPath, t2Path, outPath, ...specs] = process.argv.slice(2);
if (specs.length === 0) {
  console.error("usage: spec014-fused.mjs <truth.f32pack> <t2.ndjson> <out.json> <k:M>...");
  process.exit(2);
}
/** The frozen reference, decision 29: imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8. */
const REF = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
};
const N = 5;
const variants = specs.map((s) => {
  const [k, m] = s.split(":").map(Number);
  return { name: k === 0 ? "imm" : `fused-k${k}-m${m}`, k, m };
});

const rows = g5Rows(scenarioSource(truthPath));
const byScenario = new Map();
for (const r of rows) {
  const list = byScenario.get(r.s.metadata.index) ?? [];
  list.push(r);
  byScenario.set(r.s.metadata.index, list);
}

/** Log-range update of one model's Gaussian in place; returns ν²/S. */
function rangeUpdate(g, z, ox, oy, r2) {
  const dx = (g.x[0] ?? 0) - ox;
  const dy = (g.x[1] ?? 0) - oy;
  const rho2 = dx * dx + dy * dy;
  const h = [dx / rho2, dy / rho2, 0, 0, 0];
  const ph = new Float64Array(N);
  for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) ph[i] += g.p[N * i + k] * h[k];
  const s = r2 + h[0] * ph[0] + h[1] * ph[1];
  const kg = ph.map((v) => v / s);
  const nu = z - 0.5 * Math.log(rho2);
  for (let i = 0; i < N; i++) g.x[i] += kg[i] * nu;
  // Joseph form: (I − KH) P (I − KH)ᵀ + K R Kᵀ.
  const ikh = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) ikh[N * i + j] = (i === j ? 1 : 0) - kg[i] * h[j];
  const tmp = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let v = 0;
      for (let k = 0; k < N; k++) v += ikh[N * i + k] * g.p[N * k + j];
      tmp[N * i + j] = v;
    }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let v = 0;
      for (let k = 0; k < N; k++) v += tmp[N * i + k] * ikh[N * j + k];
      g.p[N * i + j] = v + r2 * kg[i] * kg[j];
    }
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const a = (g.p[N * i + j] + g.p[N * j + i]) / 2;
      g.p[N * i + j] = a;
      g.p[N * j + i] = a;
    }
  return (nu * nu) / s;
}

function plausible(d, x, i) {
  const [px, py, vx, vy, w] = x;
  const range = Math.hypot(px - d.ownX[i], py - d.ownY[i]);
  return (
    [px, py, vx, vy, w].every(Number.isFinite) &&
    Math.hypot(vx, vy) <= PLAUSIBLE.maxSpeedMps &&
    range > 0 &&
    range <= PLAUSIBLE.maxRangeM
  );
}

/** Fused IMM over one scenario up to sample `last`; estimates (or null) at each sample. */
function run(s, t2ByK, v, last, nis) {
  const d = bearingData(s);
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2 * REF.rScale;
  const first = s.metadata.zig_index + 1;
  const out = new Map();
  let st = immInitialise(d, first - 1, sigma, REF.p0Scale);
  let lastTry = first - 1;
  for (let i = first; i <= last; i++) {
    if (st !== null) {
      const z =
        d.valid[i] === 1 ? { bearing: d.bearing[i], ox: d.ownX[i], oy: d.ownY[i], r2 } : null;
      st = immStep(st, d.t[i], z, REF);
      const t = t2ByK.get(i);
      if (v.k > 0 && t !== undefined && t.converged && (i - first) % v.m === 0) {
        const rr = (v.k * t.log_range_sd) ** 2;
        for (const g of st.models) {
          nis.sum += rangeUpdate(g, Math.log(t.range_m), d.ownX[i], d.ownY[i], rr) / 2;
        }
        nis.n++;
      }
      const est = immEstimate(st).x;
      if (plausible(d, est, i)) {
        out.set(i, est);
        continue;
      }
      st = null;
      lastTry = i - EKF_REINIT_EVERY;
    }
    if (i - lastTry >= EKF_REINIT_EVERY) {
      st = immInitialise(d, i, sigma, REF.p0Scale);
      lastTry = i;
    }
  }
  return out;
}

const deg = (a) => (a * 180) / Math.PI;
const wrap = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
const KT = 1.943844;
const after = (r) => (r.s.metadata.manoeuvres ?? []).some((m) => m.end_index <= r.k);
const SLICES = {
  all: () => true,
  settled: (r) => r.settled,
  "settled-before": (r) => r.settled && !after(r),
  "settled-after": (r) => r.settled && after(r),
  unsettled: (r) => !r.settled,
};
const names = [...variants.map((v) => v.name), "t2", "hybrid-c45"];
const errs = Object.fromEntries(
  names.map((n) => [n, Object.fromEntries(Object.keys(SLICES).map((s) => [s, [[], [], []]]))]),
);
const nisBy = Object.fromEntries(variants.map((v) => [v.name, { sum: 0, n: 0 }]));

function score(name, r, est) {
  const o = r.s.ownship.states[r.k];
  const t = r.s.target.states[r.k];
  const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  const e =
    est === null
      ? [Infinity, Infinity, Infinity]
      : [
          Math.abs(est.range - range) / range,
          deg(wrap(est.course - t.course_rad)),
          Math.abs(est.speed - t.speed_mps) * KT,
        ];
  for (const [s, f] of Object.entries(SLICES))
    if (f(r)) e.forEach((x, i) => errs[name][s][i].push(x));
}
const fromState = (d, x, i) => ({
  range: Math.hypot(x[0] - d.ownX[i], x[1] - d.ownY[i]),
  course: Math.atan2(x[2], x[3]),
  speed: Math.hypot(x[2], x[3]),
  x,
});

let done = 0;
for await (const line of createInterface({ input: createReadStream(t2Path) })) {
  if (!line.includes('"prediction"')) continue;
  const p = JSON.parse(line);
  const list = byScenario.get(p.scenario_index);
  if (list === undefined) continue;
  const s = list[0].s;
  const dt = s.metadata.parameters.dt_s;
  const t2ByK = new Map(p.rows.map((x) => [Math.round(x.timestamp_s / dt), x]));
  const last = Math.max(...list.map((r) => r.k));
  const d = bearingData(s);
  let immRows = null;
  for (const v of variants) {
    const out = run(s, t2ByK, v, last, nisBy[v.name]);
    if (v.k === 0) immRows = out;
    for (const r of list) {
      const x = out.get(r.k);
      score(v.name, r, x === undefined ? null : fromState(d, x, r.k));
    }
  }
  for (const r of list) {
    const t = t2ByK.get(r.k);
    const tEst = t?.converged
      ? { range: t.range_m, course: t.course_rad, speed: t.speed_mps }
      : null;
    score("t2", r, tEst);
    if (immRows !== null) {
      const x = immRows.get(r.k);
      const immRow =
        x === undefined
          ? {
              converged: false,
              range_m: 0,
              course_rad: 0,
              speed_mps: 0,
              x_m: 0,
              y_m: 0,
              timestamp_s: 0,
            }
          : {
              converged: true,
              range_m: fromState(d, x, r.k).range,
              course_rad: fromState(d, x, r.k).course,
              speed_mps: fromState(d, x, r.k).speed,
              x_m: x[0],
              y_m: x[1],
              timestamp_s: 0,
            };
      const h = t === undefined ? immRow : trackerHybridRow(immRow, t, 45);
      score(
        "hybrid-c45",
        r,
        h.converged ? { range: h.range_m, course: h.course_rad, speed: h.speed_mps } : null,
      );
    }
  }
  if (++done % 1000 === 0) console.error(`${done} scenarios`);
}

const median = (xs) => {
  const s = Float64Array.from(xs).sort();
  return s[Math.floor(s.length / 2)];
};
const out = { truth: truthPath, t2: t2Path, reference: REF, g5_rows: rows.length, estimators: {} };
for (const n of names) {
  if (errs[n].all[0].length === 0) continue;
  const e = {};
  for (const s of Object.keys(SLICES))
    e[s] = {
      n: errs[n][s][0].length,
      range_pct: +(100 * median(errs[n][s][0])).toFixed(2),
      course_deg: +median(errs[n][s][1]).toFixed(2),
      speed_kt: +median(errs[n][s][2]).toFixed(3),
    };
  const v = nisBy[n];
  if (v !== undefined && v.n > 0) e.range_nis = +(v.sum / v.n).toFixed(3);
  out.estimators[n] = e;
}
// Ratios to the IMM (G5's five checks: overall range, course < 1; settled range, course, speed < 1.1).
const base = out.estimators.imm;
if (base !== undefined)
  for (const [n, e] of Object.entries(out.estimators)) {
    const q = (s, m) => +(e[s][m] / base[s][m]).toFixed(3);
    e.ratios = {
      overall_range: q("all", "range_pct"),
      overall_course: q("all", "course_deg"),
      settled_range: q("settled", "range_pct"),
      settled_course: q("settled", "course_deg"),
      settled_speed: q("settled", "speed_kt"),
      settled_before_range: q("settled-before", "range_pct"),
      settled_after_range: q("settled-after", "range_pct"),
    };
    const r = e.ratios;
    e.min_margin = +Math.min(
      1 - r.overall_range,
      1 - r.overall_course,
      (1.1 - r.settled_range) / 1.1,
      (1.1 - r.settled_course) / 1.1,
      (1.1 - r.settled_speed) / 1.1,
    ).toFixed(3);
    console.log(
      `${n.padEnd(16)} margin ${String(e.min_margin).padEnd(7)} R ${r.overall_range} C ${r.overall_course} | settled R ${r.settled_range} C ${r.settled_course} S ${r.settled_speed} | before R ${r.settled_before_range} after R ${r.settled_after_range}${e.range_nis === undefined ? "" : ` | NIS ${e.range_nis}`}`,
    );
  }
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
