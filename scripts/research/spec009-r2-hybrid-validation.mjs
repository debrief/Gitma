// Spec 009 R2: the hybrid (classical seeded by the iteration-4 LSTM) against classical and the
// LSTM on seed 205's validation split, σ = 1°: medians and gross-error rates at the G2 points.
// usage: node scripts/research/spec009-r2-hybrid-validation.mjs <validation.f32pack> <lstm.ndjson> [limit]
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  bearingData,
  classicalPredict,
  levenbergMarquardt,
  plausible,
  rowAt,
  solveBatch,
} from "../../packages/classical/dist/index.js";
import { readPack } from "../../packages/data/dist/index.js";
// The init-only hybrid R2 tested (not shipped): Levenberg–Marquardt from the network's estimate
// and from the previous row's solution, the lower-cost usable one kept; the grid only if neither.
const usable = (d, s, i) => s !== null && s.converged && plausible(d, s, i);
function hybridPredict(s, network) {
  const d = bearingData(s);
  const first = s.metadata.zig_index + 1;
  const rows = [];
  let prev = null;
  for (let i = first; i < s.metadata.samples; i++) {
    const r = network.rows[i - first];
    const vx = r.speed_mps * Math.sin(r.course_rad);
    const vy = r.speed_mps * Math.cos(r.course_rad);
    const start = Float64Array.from([r.x_m - vx * d.t[i], r.y_m - vy * d.t[i], vx, vy]);
    const fromNet = levenbergMarquardt(d, start, i + 1);
    const warm = prev === null ? null : levenbergMarquardt(d, prev.theta, i + 1);
    let sol = null;
    for (const c of [fromNet, warm])
      if (usable(d, c, i) && (sol === null || c.cost < sol.cost)) sol = c;
    if (sol === null) {
      const grid = solveBatch(d, i + 1);
      sol = usable(d, grid, i) ? grid : (grid ?? fromNet);
    }
    const ok = usable(d, sol, i);
    const row = rowAt(d, sol, i);
    rows.push(ok ? row : { ...row, converged: false });
    prev = ok ? sol : null;
  }
  return { rows };
}
const [pack, lstmFile, limitArg] = process.argv.slice(2);
const limit = Number(limitArg ?? Infinity);
const KT = 1.943844;
const net = new Map();
for await (const line of createInterface({ input: createReadStream(lstmFile) })) {
  if (!line) continue;
  const p = JSON.parse(line);
  if (p.record === "prediction") net.set(p.scenario_index, p);
}
const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN;
};
const p90 = (a) => {
  const b = Float64Array.from(a).sort();
  return b.length ? b[Math.max(0, Math.ceil(0.9 * b.length) - 1)] : NaN;
};
const acc = {};
const rec = (est, pt, e) => ((acc[est] ??= {})[pt] ??= []).push(e);
const err = (row, s, k) => {
  const o = s.ownship.states[k],
    t = s.target.states[k];
  const r = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  const rangeRel = Math.abs(row.range_m - r) / r;
  let dc = Math.abs(row.course_rad - t.course_rad) % (2 * Math.PI);
  if (dc > Math.PI) dc = 2 * Math.PI - dc;
  return {
    range: rangeRel,
    course: (dc * 180) / Math.PI,
    speed: Math.abs(row.speed_mps - t.speed_mps) * KT,
    gross: !row.converged || !(rangeRel <= 0.5),
  };
};
let n = 0;
let fallbacks = 0;
const t0 = Date.now();
for (const s of readPack(pack).scenarios()) {
  if (Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6) continue;
  if (n >= limit) break;
  n++;
  const z = s.metadata.zig_index;
  const first = z + 1;
  const nn = net.get(s.metadata.index);
  const c = classicalPredict(s, "per_timestep");
  const h = hybridPredict(s, nn);
  for (const [pt, k] of [
    ["zig+300", z + 30],
    ["zig+600", z + 60],
    ["final", s.metadata.samples - 1],
  ]) {
    if (k >= s.metadata.samples) continue;
    for (const [est, p] of [
      ["classical", c],
      ["hybrid", h],
      ["lstm", nn],
    ])
      rec(est, pt, err(p.rows[k - first], s, k));
  }
}
console.log(`σ=1° scenarios ${n}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const pt of ["zig+300", "zig+600", "final"]) {
  for (const est of ["classical", "hybrid", "lstm"]) {
    const v = acc[est][pt];
    const ok = v.filter((e) => Number.isFinite(e.range));
    console.log(
      `${pt.padEnd(8)} ${est.padEnd(9)} n ${v.length} | range ${(median(ok.map((e) => e.range)) * 100).toFixed(2)}% p90 ${(p90(ok.map((e) => e.range)) * 100).toFixed(1)}% | course ${median(ok.map((e) => e.course)).toFixed(2)}° p90 ${p90(ok.map((e) => e.course)).toFixed(1)} | speed ${median(ok.map((e) => e.speed)).toFixed(3)} kt p90 ${p90(ok.map((e) => e.speed)).toFixed(2)} | gross ${((v.filter((e) => e.gross).length / v.length) * 100).toFixed(2)}%`,
    );
  }
}
