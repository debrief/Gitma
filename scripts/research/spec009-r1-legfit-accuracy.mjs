// Spec 009 R1: accuracy of the per-leg fit (ḃ, ṙ/r) against truth, beside the 3-min trailing rate.
// usage: node scripts/research/spec009-r1-legfit-accuracy.mjs <validation.f32pack>
import { readPack } from "../../packages/data/dist/index.js";
import { scenarioBearingRate } from "../../packages/features/dist/index.js";
import { legFit } from "./spec009-legfit.mjs";
const [pack] = process.argv.slice(2);
const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN;
};
// Points: zig+300 s, zig+600 s (as the gates), and the last row before the first zig.
const pts = { prezig: [], "zig+300": [], "zig+600": [] };
const add = (k, v) => pts[k].push(v);
let n = 0;
for (const s of readPack(pack).scenarios()) {
  if (Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6) continue;
  n++;
  const N = s.metadata.samples;
  const obs = s.observations;
  const own = s.ownship.states;
  const f = legFit(
    obs.map((o) => o.timestamp_s),
    obs.map((o) => o.bearing_rad),
    obs.map((o) => o.valid),
    own.map((o) => o.course_rad),
    own.map((o) => o.speed_mps),
    N,
  );
  const tr = scenarioBearingRate(s);
  const z = s.metadata.zig_index;
  // the zig turn starts where ownship course first changes
  let turn = 1;
  while (turn < N && own[turn].course_rad === own[turn - 1].course_rad) turn++;
  const truth = (k) => {
    const o = own[k],
      t = s.target.states[k];
    const px = t.x_m - o.x_m,
      py = t.y_m - o.y_m;
    const wx = t.speed_mps * Math.sin(t.course_rad) - o.speed_mps * Math.sin(o.course_rad);
    const wy = t.speed_mps * Math.cos(t.course_rad) - o.speed_mps * Math.cos(o.course_rad);
    const r2 = px * px + py * py;
    return { rate: (py * wx - px * wy) / r2, ratio: (px * wx + py * wy) / r2 };
  };
  for (const [name, k] of [
    ["prezig", turn - 1],
    ["zig+300", z + 30],
    ["zig+600", z + 60],
  ]) {
    if (k < 0 || k >= N || f.valid[k] !== 1) continue;
    const T = truth(k);
    add(name, {
      age: f.legAge[k],
      eRate: Math.abs(f.bearingRate[k] - T.rate),
      eTrail: tr.valid[k] === 1 ? Math.abs(tr.rate[k] - T.rate) : NaN,
      eRatio: Math.abs(f.rangeRateRatio[k] - T.ratio),
      absRatio: Math.abs(T.ratio),
      absRate: Math.abs(T.rate),
      res: f.residual[k],
    });
  }
}
const d = 180 / Math.PI;
console.log(`σ=1° scenarios: ${n}`);
for (const [k, v] of Object.entries(pts)) {
  const g = (f) => median(v.map(f).filter(Number.isFinite));
  console.log(
    `${k}: n ${v.length}, leg age ${g((r) => r.age).toFixed(0)} s | |ḃ| true ${(g((r) => r.absRate) * d * 60).toFixed(3)} °/min, ` +
      `err legfit ${(g((r) => r.eRate) * d * 60).toFixed(4)}, trailing-3min ${(g((r) => r.eTrail) * d * 60).toFixed(4)} °/min | ` +
      `|ṙ/r| true ${(g((r) => r.absRatio) * 3600).toFixed(3)} /h, err ${(g((r) => r.eRatio) * 3600).toFixed(3)} /h | residual ${(g((r) => r.res) * d).toFixed(3)}°`,
  );
}
