// Spec 013, panel round 1: settled G5 rows split into "before any manoeuvre" and "after a
// manoeuvre", median errors of each estimator on the same rows (non-converged rows count as
// infinite, as in tma-g5). Shows what the pooled settled checks average over.
//
//   pnpm build
//   node scripts/research/spec013-slices.mjs <truth.f32pack> <label=pred.ndjson>...
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { g5Rows, scenarioSource } from "../../packages/eval/dist/index.js";

const [truthPath, ...sets] = process.argv.slice(2);
const rows = g5Rows(scenarioSource(truthPath)).filter((r) => r.settled);
const byScenario = new Map();
for (const r of rows) {
  const list = byScenario.get(r.s.metadata.index) ?? [];
  list.push(r);
  byScenario.set(r.s.metadata.index, list);
}
const slice = (r) =>
  (r.s.metadata.manoeuvres ?? []).some((m) => m.end_index <= r.k) ? "after" : "before";
const deg = (a) => (a * 180) / Math.PI;
const wrap = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
const KT = 1.943844;
const median = (xs) => Float64Array.from(xs).sort()[Math.floor(xs.length / 2)];

const out = {};
for (const spec of sets) {
  const [label, path] = spec.split("=");
  const e = { before: [[], [], []], after: [[], [], []] };
  for await (const line of createInterface({ input: createReadStream(path) })) {
    if (!line.includes('"prediction"')) continue;
    const p = JSON.parse(line);
    const list = byScenario.get(p.scenario_index);
    if (list === undefined) continue;
    for (const r of list) {
      const dt = r.s.metadata.parameters.dt_s;
      const row = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
      const o = r.s.ownship.states[r.k];
      const t = r.s.target.states[r.k];
      const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
      const ok = row !== undefined && row.converged;
      const v = ok
        ? [
            Math.abs(row.range_m - range) / range,
            deg(wrap(row.course_rad - t.course_rad)),
            Math.abs(row.speed_mps - t.speed_mps) * KT,
          ]
        : [Infinity, Infinity, Infinity];
      v.forEach((x, i) => e[slice(r)][i].push(x));
    }
  }
  out[label] = Object.fromEntries(
    ["before", "after"].map((s) => [
      s,
      {
        n: e[s][0].length,
        range: +median(e[s][0]).toFixed(4),
        course_deg: +median(e[s][1]).toFixed(2),
        speed_kt: +median(e[s][2]).toFixed(3),
      },
    ]),
  );
}
console.log(JSON.stringify(out, null, 2));
