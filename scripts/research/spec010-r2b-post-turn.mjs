// Spec 010 FR-011 (G0 panel round 2, red team): the frozen reference under noise after the turn.
// On σ = 1° turning scenarios whose target turn ends before ownship's second zig starts (so
// ownship manoeuvres after the turn), compare at manoeuvre + 300 s the reference tracker's range
// error with batch least squares fitted to the bearings from manoeuvre_index on only (the
// post-turn track, observable through ownship's zig).
//   node scripts/research/spec010-r2b-post-turn.mjs <validation.f32pack> <reference.ndjson>
import { readFileSync } from "node:fs";
import { bearingData, rowAt, solveBatch } from "../../packages/classical/dist/index.js";
import { readDataset } from "../../packages/data/dist/index.js";

const [pack, refPath] = process.argv.slice(2);
const ref = new Map();
for (const l of readFileSync(refPath, "utf8").split("\n").slice(1))
  if (l) {
    const p = JSON.parse(l);
    ref.set(p.scenario_index, p);
  }
const a = [];
const b = [];
for (const s of readDataset(pack).scenarios()) {
  const m = s.metadata;
  if (m.manoeuvre_index == null || Math.abs(m.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6)
    continue;
  const zig2Start = m.turn2_start_index != null ? m.turn2_start_index - 1 : (m.zig2_index ?? -1);
  if (!(m.manoeuvre_index <= zig2Start)) continue;
  const k = m.manoeuvre_index + 30;
  const o = s.ownship.states[k];
  const t = s.target.states[k];
  const truth = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  const d = bearingData(s);
  const lo = m.manoeuvre_index;
  const sub = {
    t: d.t.subarray(lo),
    ownX: d.ownX.subarray(lo),
    ownY: d.ownY.subarray(lo),
    bearing: d.bearing.subarray(lo),
    valid: d.valid.subarray(lo),
  };
  const sol = solveBatch(sub, k + 1 - lo);
  const rb = sol === null ? null : rowAt(sub, sol, k - lo);
  b.push(rb === null || !sol.converged ? Infinity : Math.abs(rb.range_m - truth) / truth);
  const dt = m.parameters.dt_s;
  const r = ref.get(m.index).rows.find((x) => Math.round(x.timestamp_s / dt) === k);
  a.push(r === undefined || !r.converged ? Infinity : Math.abs(r.range_m - truth) / truth);
}
const q = (v, p) => [...v].sort((x, y) => x - y)[Math.floor(p * (v.length - 1))];
console.log(
  JSON.stringify({
    n: a.length,
    reference_median: q(a, 0.5),
    reference_p90: q(a, 0.9),
    post_turn_batch_median: q(b, 0.5),
    post_turn_batch_p90: q(b, 0.9),
    ratio: q(a, 0.5) / q(b, 0.5),
  }),
);
