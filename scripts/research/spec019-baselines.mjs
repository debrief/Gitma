// Spec 019 (reported beside G5, Annex C §C.14; G5 panel phase 7): on the G5 rows of a split, the
// median and P90 of range (relative), course and speed error of each prediction file, overall, settled,
// and settled before / after any manoeuvre. Then the carried file's median ratio against each other
// file, with a scenario-clustered paired bootstrap 97.5% interval (2,000 resamples, seed 20261011),
// as tma-g5 computes its own. Reported, not gated. A row with no converged estimate is +∞, as G5.
//   node scripts/research/spec019-baselines.mjs <truth.f32pack> <out.json> <carried.ndjson> <other.ndjson>...
import { writeFileSync } from "node:fs";
import { bootstrapClusteredQuantileRatio } from "../../packages/eval/dist/bootstrap.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, out, ...files] = process.argv.slice(2);
if (files.length < 2) {
  console.error("usage: spec019-baselines.mjs <truth> <out.json> <carried> <other>...");
  process.exit(2);
}
const sets = files.map((f) => openPredictionSet(f, truth));
const METRICS = ["range_rel", "course_deg", "speed_kt"];
const rows = [];
let cluster = 0;
for (const s of scenarioSource(truth)) {
  const rs = g5Rows([s]);
  if (rs.length === 0) continue;
  const dt = s.metadata.parameters.dt_s;
  const after = (k) => (s.metadata.manoeuvres ?? []).some((m) => m.end_index <= k);
  for (const r of rs) {
    const e = sets.map((set) => {
      const p = set.byIndex.get(s.metadata.index);
      if (p === undefined) throw new Error(`${set.label}: no prediction for ${s.metadata.index}`);
      const row = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
      return METRICS.map((m) =>
        row === undefined || !row.converged ? Infinity : rowError(s, row)[m],
      );
    });
    rows.push({ cluster, settled: r.settled, after: after(r.k), e });
  }
  cluster++;
}
const q = (v, p) => {
  const b = Float64Array.from(v).sort();
  return b[Math.floor(p * (b.length - 1))];
};
const groups = [
  ["all G5 rows", () => true],
  ["settled", (r) => r.settled],
  ["settled, before any manoeuvre", (r) => r.settled && !r.after],
  ["settled, after a manoeuvre", (r) => r.settled && r.after],
];
const medians = [];
const ratios = [];
for (const [name, pred] of groups) {
  const sub = rows.filter(pred);
  const ids = new Map();
  const cl = Int32Array.from(sub, (r) => {
    if (!ids.has(r.cluster)) ids.set(r.cluster, ids.size);
    return ids.get(r.cluster);
  });
  sets.forEach((set, i) =>
    METRICS.forEach((m, j) => {
      const v = sub.map((r) => r.e[i][j]);
      medians.push({
        estimator: set.estimator,
        rows: name,
        metric: m,
        n: v.length,
        non_converged: v.filter((x) => x === Infinity).length,
        median: q(v, 0.5),
        p90: q(v, 0.9),
      });
    }),
  );
  for (let i = 1; i < sets.length; i++)
    METRICS.forEach((m, j) => {
      const a = Float64Array.from(sub, (r) => r.e[0][j]);
      const b = Float64Array.from(sub, (r) => r.e[i][j]);
      const x = bootstrapClusteredQuantileRatio(a, b, cl, 0.5, 0.975, 2000, 20261011n);
      ratios.push({
        rows: name,
        metric: m,
        ratio: `${sets[0].estimator} / ${sets[i].estimator}`,
        value: x.ratio,
        ci975: [x.lo, x.hi],
      });
    });
}
writeFileSync(out, `${JSON.stringify({ truth, rows: rows.length, medians, ratios }, null, 2)}\n`);
console.log(`${out}: ${String(rows.length)} rows`);
