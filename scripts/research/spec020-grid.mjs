// Spec 020 (SRD Annex C §C.15): the fusion re-tune's selection, applied mechanically. On the G5 rows
// of a validation split, for each fused variant, six point ratios of medians:
//   - the five G5 checks against the IMM (overall range and course, limit 1; settled range, course
//     and speed, limit 1.1);
//   - fused / T2 median range error over all G5 rows (limit 1).
// A check's margin is (limit − point) / limit; a variant's score is its smallest margin. The
// carried variant has the largest score; ties within 0.005 go to the larger k, then the larger M.
// A row with no converged estimate is +∞, as in G5. Prints the table and the choice as JSON.
//   node scripts/research/spec020-grid.mjs <truth.f32pack> <imm.ndjson> <t2.ndjson> <fused.ndjson>...
import { parseFusedName } from "../../packages/classical/dist/names.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, immPath, t2Path, ...fusedPaths] = process.argv.slice(2);
if (fusedPaths.length === 0) {
  console.error("usage: spec020-grid.mjs <truth> <imm> <t2> <fused>...");
  process.exit(2);
}
const imm = openPredictionSet(immPath, truth);
const t2 = openPredictionSet(t2Path, truth);
const variants = fusedPaths.map((p) => {
  const set = openPredictionSet(p, truth);
  const parsed = parseFusedName(set.estimator, t2.estimator);
  if (parsed === null) throw new Error(`${p}: ${set.estimator} is not a fusion of ${t2.estimator}`);
  return { set, k: parsed.fusion.k, m: parsed.fusion.every };
});
const METRICS = ["range_rel", "course_deg", "speed_kt"];
const err = (set, s, k) => {
  const p = set.byIndex.get(s.metadata.index);
  if (p === undefined) throw new Error(`${set.label}: no prediction for ${s.metadata.index}`);
  const dt = s.metadata.parameters.dt_s;
  const r = p.rows.find((x) => Math.round(x.timestamp_s / dt) === k);
  return METRICS.map((m) => (r === undefined || !r.converged ? Infinity : rowError(s, r)[m]));
};
// rows[i] = { settled, imm: [..], t2: [..], v: [[..] per variant] }
const rows = [];
for (const s of scenarioSource(truth))
  for (const r of g5Rows([s]))
    rows.push({
      settled: r.settled,
      imm: err(imm, s, r.k),
      t2: err(t2, s, r.k),
      v: variants.map((x) => err(x.set, s, r.k)),
    });
const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b[Math.floor((b.length - 1) / 2)];
};
const settled = rows.filter((r) => r.settled);
const med = (set, pick, j) => median(set.map((r) => pick(r)[j]));
const checks = [
  ["overall range / IMM", rows, 0, "imm", 1],
  ["overall course / IMM", rows, 1, "imm", 1],
  ["settled range / IMM", settled, 0, "imm", 1.1],
  ["settled course / IMM", settled, 1, "imm", 1.1],
  ["settled speed / IMM", settled, 2, "imm", 1.1],
  ["overall range / T2", rows, 0, "t2", 1],
];
const table = variants.map((x, i) => {
  const points = checks.map(([name, set, j, ref, limit]) => {
    const point = med(set, (r) => r.v[i], j) / med(set, (r) => r[ref], j);
    return { check: name, point, limit, margin: (limit - point) / limit };
  });
  return {
    estimator: x.set.estimator,
    k: x.k,
    m: x.m,
    points,
    score: Math.min(...points.map((p) => p.margin)),
  };
});
const best = Math.max(...table.map((t) => t.score));
const chosen = table
  .filter((t) => t.score >= best - 0.005)
  .sort((a, b) => b.k - a.k || b.m - a.m)[0];
console.log(
  JSON.stringify(
    {
      truth,
      rows: rows.length,
      settled_rows: settled.length,
      rule: "largest smallest margin; ties within 0.005 to the larger k, then the larger M",
      variants: table,
      best_score: best,
      chosen: chosen.estimator,
      carried: chosen.score > 0,
    },
    null,
    2,
  ),
);
