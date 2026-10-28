// Spec 010 R1: how soon a target turn shows in the bearings. For each σ = 1° turning scenario of
// a split: batch least squares on the samples before the turn starts, then the first sample
// after the turn starts at which three consecutive valid bearings each depart from that fit by
// more than 3σ. Reported as time since the turn ends (negative: during the turn), by |angle| band
// and by range band (mean range), with the share detected by the G4 point (manoeuvre + 300 s).
//   node scripts/research/spec010-r1-visibility.mjs <validation.f32pack>
import { angleDiff, bearingOf } from "../../packages/sim/dist/index.js";
import { bearingData, solveBatch } from "../../packages/classical/dist/index.js";
import { readDataset } from "../../packages/data/dist/index.js";

const [pack] = process.argv.slice(2);
const SIGMA = Math.PI / 180;
const rows = [];
for (const s of readDataset(pack).scenarios()) {
  const m = s.metadata;
  if (m.manoeuvre_index == null || Math.abs(m.parameters.noise_sigma_rad - SIGMA) > 1e-6) continue;
  const k = m.manoeuvre_start_index - 1;
  const d = bearingData(s);
  const sol = solveBatch(d, k + 1);
  if (sol === null) continue;
  const [x0, y0, vx, vy] = sol.theta;
  const dt = m.parameters.dt_s;
  let run = 0;
  let found = null;
  for (let i = k + 1; i < m.samples; i++) {
    if (d.valid[i] !== 1) continue;
    const t = d.t[i];
    const r = angleDiff(d.bearing[i], bearingOf(x0 + vx * t - d.ownX[i], y0 + vy * t - d.ownY[i]));
    run = Math.abs(r) > 3 * SIGMA ? run + 1 : 0;
    if (run === 3) {
      found = i;
      break;
    }
  }
  rows.push({
    angle: Math.abs((m.parameters.target_manoeuvre_angle_rad * 180) / Math.PI),
    km: m.mean_range_m / 1000,
    afterEnd: found === null ? Infinity : (found - m.manoeuvre_index) * dt,
    byGate: found !== null && found <= m.manoeuvre_index + 30,
  });
}
const q = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
};
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(0) : "never");
const report = (label, sel) => {
  const v = rows.filter(sel);
  if (v.length === 0) return;
  const t = v.map((r) => r.afterEnd);
  console.log(
    `| ${label} | ${String(v.length)} | ${fmt(q(t, 0.5))} | ${fmt(q(t, 0.9))} | ${((100 * v.filter((r) => r.byGate).length) / v.length).toFixed(1)}% |`,
  );
};
console.log("| Slice | n | Median s after turn end | P90 | Detected by manoeuvre + 300 s |");
console.log("| --- | --- | --- | --- | --- |");
report("all", () => true);
for (const [lo, hi] of [
  [30, 60],
  [60, 90],
  [90, 120.01],
])
  report(`${lo}–${Math.round(hi)}°`, (r) => r.angle >= lo && r.angle < hi);
for (const [lo, hi] of [
  [0, 5],
  [5, 10],
  [10, 20],
  [20, 40],
])
  report(`${lo}–${hi} km`, (r) => r.km >= lo && r.km < hi);
