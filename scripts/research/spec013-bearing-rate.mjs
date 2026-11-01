// Spec 013 follow-up (G5 panel, phase 4b): is each estimator's output one consistent track state?
// A tracker's position and velocity together imply a bearing rate,
//   db/dt = (dy·vx_rel − dx·vy_rel) / r²,  b = atan2(dx, dy),
// with (dx, dy) the estimated target position relative to ownship and v_rel the estimated target
// velocity less ownship's (from the scenario). The hybrid takes its position from T2 and, on most
// rows, its velocity from the IMM, so its implied rate need not match the bearings. Two measures on
// the G5 rows, each against truth (noise-free bearings):
// - bearing-rate error, |implied − true| in degrees per minute;
// - dead-reckoning bearing error: the state propagated 300 s at constant velocity, bearing from
//   ownship's true position then, against the true bearing then (rows with 300 s of data left).
// Non-converged rows are skipped and counted. Medians and P90s, overall and on settled rows.
//
//   pnpm build
//   node scripts/research/spec013-bearing-rate.mjs <truth.f32pack> <out.json> <label=pred.ndjson>...
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { g5Rows, scenarioSource } from "../../packages/eval/dist/index.js";

const [truthPath, outPath, ...sets] = process.argv.slice(2);
if (sets.length === 0) {
  console.error(
    "usage: spec013-bearing-rate.mjs <truth.f32pack> <out.json> <label=pred.ndjson>...",
  );
  process.exit(2);
}
const AHEAD_S = 300;
const rows = g5Rows(scenarioSource(truthPath));
const byScenario = new Map();
for (const r of rows) {
  const list = byScenario.get(r.s.metadata.index) ?? [];
  list.push(r);
  byScenario.set(r.s.metadata.index, list);
}
const deg = (a) => (a * 180) / Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const vel = (course, speed) => [speed * Math.sin(course), speed * Math.cos(course)];
const rate = (dx, dy, vx, vy) => (dy * vx - dx * vy) / (dx * dx + dy * dy);
const quantile = (xs, q) => {
  const s = Float64Array.from(xs).sort();
  return s.length === 0 ? null : +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(4);
};
const summary = (xs) => ({ n: xs.length, median: quantile(xs, 0.5), p90: quantile(xs, 0.9) });

const out = { truth: truthPath, ahead_s: AHEAD_S, g5_rows: rows.length, estimators: {} };
for (const spec of sets) {
  const [label, path] = spec.split("=");
  const e = {
    rate: { all: [], settled: [] },
    drift: { all: [], settled: [] },
    non_converged: 0,
  };
  for await (const line of createInterface({ input: createReadStream(path) })) {
    if (!line.includes('"prediction"')) continue;
    const p = JSON.parse(line);
    const list = byScenario.get(p.scenario_index);
    if (list === undefined) continue;
    for (const r of list) {
      const dt = r.s.metadata.parameters.dt_s;
      const row = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
      if (row === undefined || !row.converged) {
        e.non_converged++;
        continue;
      }
      const o = r.s.ownship.states[r.k];
      const t = r.s.target.states[r.k];
      const [ox, oy] = vel(o.course_rad, o.speed_mps);
      const [tx, ty] = vel(t.course_rad, t.speed_mps);
      const [ex, ey] = vel(row.course_rad, row.speed_mps);
      const truth = rate(t.x_m - o.x_m, t.y_m - o.y_m, tx - ox, ty - oy);
      const implied = rate(row.x_m - o.x_m, row.y_m - o.y_m, ex - ox, ey - oy);
      const sets = r.settled ? ["all", "settled"] : ["all"];
      const rateErr = Math.abs(deg(implied - truth)) * 60;
      for (const s of sets) e.rate[s].push(rateErr);
      const j = r.k + Math.round(AHEAD_S / dt);
      const o2 = r.s.ownship.states[j];
      const t2 = r.s.target.states[j];
      if (o2 === undefined || t2 === undefined) continue;
      const px = row.x_m + ex * AHEAD_S;
      const py = row.y_m + ey * AHEAD_S;
      const b = Math.atan2(px - o2.x_m, py - o2.y_m);
      const bTrue = Math.atan2(t2.x_m - o2.x_m, t2.y_m - o2.y_m);
      const drift = Math.abs(deg(wrap(b - bTrue)));
      for (const s of sets) e.drift[s].push(drift);
    }
  }
  out.estimators[label] = {
    file: path,
    non_converged: e.non_converged,
    bearing_rate_error_deg_per_min: { all: summary(e.rate.all), settled: summary(e.rate.settled) },
    dead_reckoning_bearing_error_deg: {
      all: summary(e.drift.all),
      settled: summary(e.drift.settled),
    },
  };
  const x = out.estimators[label];
  console.log(
    `${label.padEnd(8)} rate med ${x.bearing_rate_error_deg_per_min.all.median} p90 ${x.bearing_rate_error_deg_per_min.all.p90} (settled ${x.bearing_rate_error_deg_per_min.settled.median}) | drift med ${x.dead_reckoning_bearing_error_deg.all.median} p90 ${x.dead_reckoning_bearing_error_deg.all.p90} (settled ${x.dead_reckoning_bearing_error_deg.settled.median})`,
  );
}
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
