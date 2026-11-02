// Spec 014 (reported beside G5, Annex C §C.11): batch least squares on the G5 rows. At each row k it
// fits a constant-velocity target to every bearing up to k (solveBatch, grid start), the classical
// baseline; an implausible or failed fit counts as an infinite error, as tma-g5 scores
// non-converged rows. Medians of range, course and speed error overall, settled, and settled
// before / after any manoeuvre.
//
//   pnpm build
//   node scripts/research/spec014-lsq.mjs <truth.f32pack> <out.json>
import { writeFileSync } from "node:fs";
import { bearingData, plausible, rowAt, solveBatch } from "../../packages/classical/dist/index.js";
import { g5Rows, scenarioSource } from "../../packages/eval/dist/index.js";

const [truthPath, outPath] = process.argv.slice(2);
if (outPath === undefined) {
  console.error("usage: spec014-lsq.mjs <truth.f32pack> <out.json>");
  process.exit(2);
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
};
const errs = Object.fromEntries(Object.keys(SLICES).map((s) => [s, [[], [], []]]));
let failed = 0;
const rows = g5Rows(scenarioSource(truthPath));
let lastScenario = null;
let d = null;
for (const r of rows) {
  if (r.s !== lastScenario) {
    d = bearingData(r.s);
    lastScenario = r.s;
  }
  const sol = solveBatch(d, r.k + 1);
  const o = r.s.ownship.states[r.k];
  const t = r.s.target.states[r.k];
  const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  let e = [Infinity, Infinity, Infinity];
  if (sol !== null && plausible(d, sol, r.k)) {
    const p = rowAt(d, sol, r.k);
    e = [
      Math.abs(p.range_m - range) / range,
      deg(wrap(p.course_rad - t.course_rad)),
      Math.abs(p.speed_mps - t.speed_mps) * KT,
    ];
  } else failed++;
  for (const [s, f] of Object.entries(SLICES)) if (f(r)) e.forEach((x, i) => errs[s][i].push(x));
}
const median = (xs) => Float64Array.from(xs).sort()[Math.floor(xs.length / 2)];
const out = {
  truth: truthPath,
  estimator: "lsq (solveBatch at each G5 row)",
  rows: rows.length,
  failed,
};
for (const s of Object.keys(SLICES))
  out[s] = {
    n: errs[s][0].length,
    range_pct: +(100 * median(errs[s][0])).toFixed(2),
    course_deg: +median(errs[s][1]).toFixed(2),
    speed_kt: +median(errs[s][2]).toFixed(3),
  };
console.log(JSON.stringify(out));
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
