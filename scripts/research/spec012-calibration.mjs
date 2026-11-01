// Spec 012 (decision 29, "reported beside it"): calibration of T2's Gaussian head on the G5 rows.
// For log range and each velocity component, z = (estimate − truth) / predicted sd; a calibrated
// head has 68.3% of |z| ≤ 1 and 95.4% ≤ 2, and median |z| ≈ 0.674.
//
//   pnpm build
//   node scripts/research/spec012-calibration.mjs <truth.f32pack> <predictions.ndjson>
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { g5Rows, scenarioSource } from "../../packages/eval/dist/index.js";

const [truthPath, predPath] = process.argv.slice(2);
if (truthPath === undefined || predPath === undefined) {
  console.error("usage: spec012-calibration.mjs <truth.f32pack> <predictions.ndjson>");
  process.exit(2);
}

const rows = g5Rows(scenarioSource(truthPath));
const wanted = new Map();
for (const r of rows) {
  const list = wanted.get(r.s.metadata.index) ?? [];
  list.push(r);
  wanted.set(r.s.metadata.index, list);
}

const z = { log_range: [], vx: [], vy: [] };
const bySettled = { true: [], false: [] };
for await (const line of createInterface({ input: createReadStream(predPath) })) {
  if (!line.includes('"prediction"')) continue;
  const p = JSON.parse(line);
  const list = wanted.get(p.scenario_index);
  if (list === undefined) continue;
  for (const r of list) {
    const dt = r.s.metadata.parameters.dt_s;
    const row = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
    if (row === undefined || !row.converged || row.log_range_sd == null) continue;
    const o = r.s.ownship.states[r.k];
    const t = r.s.target.states[r.k];
    const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
    const zr = (Math.log(row.range_m) - Math.log(range)) / row.log_range_sd;
    const vx = row.speed_mps * Math.sin(row.course_rad);
    const vy = row.speed_mps * Math.cos(row.course_rad);
    const tvx = t.speed_mps * Math.sin(t.course_rad);
    const tvy = t.speed_mps * Math.cos(t.course_rad);
    z.log_range.push(zr);
    z.vx.push((vx - tvx) / row.vx_sd_mps);
    z.vy.push((vy - tvy) / row.vy_sd_mps);
    bySettled[r.settled].push(zr);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};
const summary = (xs) => {
  const a = xs.map(Math.abs);
  return {
    n: xs.length,
    within_1sd: +(a.filter((v) => v <= 1).length / a.length).toFixed(3),
    within_2sd: +(a.filter((v) => v <= 2).length / a.length).toFixed(3),
    median_abs_z: +median(a).toFixed(3),
    median_z: +median(xs).toFixed(3),
  };
};
console.log(
  JSON.stringify(
    {
      expected: { within_1sd: 0.683, within_2sd: 0.954, median_abs_z: 0.674 },
      log_range: summary(z.log_range),
      vx: summary(z.vx),
      vy: summary(z.vy),
      log_range_settled: summary(bySettled.true),
      log_range_not_settled: summary(bySettled.false),
    },
    null,
    2,
  ),
);
