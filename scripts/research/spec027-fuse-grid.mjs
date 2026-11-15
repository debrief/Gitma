// Spec 027 (SRD Annex E §E.3): the selection of the fused tracker on the re-tuned IMM, and of the
// gate's reference, applied mechanically. On the G5 rows of a validation split, for each fused
// variant and for each re-tuned reference (IMM and EKF), G5's five point ratios of medians (overall
// range and course, limit 1; settled range, course and speed, limit 1.1). A check's margin is
// (limit − point) / limit. A variant's margin against a reference is its smallest margin there; its
// score is the smaller of its two reference margins (it must beat both). The carried variant has
// the largest score; ties within 0.005 go to the larger k, then the larger M. The gate's reference
// is the one the carried variant's margin is smaller against (ties: the EKF). Carried only if the
// score is above 0. T2's and the frozen fused tracker's ratios are reported. A row with no
// converged estimate is +∞, as in G5. Prints JSON.
//   node scripts/research/spec027-fuse-grid.mjs <truth> <imm> <ekf> <t2> <frozen-fused> <fused>...
import { parseFusedName } from "../../packages/classical/dist/names.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, immPath, ekfPath, t2Path, frozenPath, ...fusedPaths] = process.argv.slice(2);
if (fusedPaths.length === 0) {
  console.error("usage: spec027-fuse-grid.mjs <truth> <imm> <ekf> <t2> <frozen-fused> <fused>...");
  process.exit(2);
}
const refs = { imm: openPredictionSet(immPath, truth), ekf: openPredictionSet(ekfPath, truth) };
const t2 = openPredictionSet(t2Path, truth);
const frozen = openPredictionSet(frozenPath, truth);
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
const rows = [];
for (const s of scenarioSource(truth))
  for (const r of g5Rows([s]))
    rows.push({
      settled: r.settled,
      imm: err(refs.imm, s, r.k),
      ekf: err(refs.ekf, s, r.k),
      t2: err(t2, s, r.k),
      frozen: err(frozen, s, r.k),
      v: variants.map((x) => err(x.set, s, r.k)),
    });
const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b[Math.floor((b.length - 1) / 2)];
};
const settled = rows.filter((r) => r.settled);
const CHECKS = [
  ["overall range", rows, 0, 1],
  ["overall course", rows, 1, 1],
  ["settled range", settled, 0, 1.1],
  ["settled course", settled, 1, 1.1],
  ["settled speed", settled, 2, 1.1],
];
const against = (pick, ref) => {
  const points = CHECKS.map(([check, set, j, limit]) => {
    const point = median(set.map((r) => pick(r)[j])) / median(set.map((r) => r[ref][j]));
    return { check, point, limit, margin: (limit - point) / limit };
  });
  return { points, margin: Math.min(...points.map((p) => p.margin)) };
};
const medians = (pick) =>
  Object.fromEntries(
    [
      ["all", rows],
      ["settled", settled],
    ].map(([n, set]) => [n, METRICS.map((_, j) => median(set.map((r) => pick(r)[j])))]),
  );
const table = variants.map((x, i) => {
  const pick = (r) => r.v[i];
  const vs = { imm: against(pick, "imm"), ekf: against(pick, "ekf") };
  return {
    estimator: x.set.estimator,
    k: x.k,
    m: x.m,
    vs,
    range_vs_t2: median(rows.map((r) => r.v[i][0])) / median(rows.map((r) => r.t2[0])),
    score: Math.min(vs.imm.margin, vs.ekf.margin),
  };
});
const best = Math.max(...table.map((t) => t.score));
const chosen = table
  .filter((t) => t.score >= best - 0.005)
  .sort((a, b) => b.k - a.k || b.m - a.m)[0];
const reference = chosen.vs.imm.margin < chosen.vs.ekf.margin ? "imm" : "ekf";
console.log(
  JSON.stringify(
    {
      truth,
      rows: rows.length,
      settled_rows: settled.length,
      references: { imm: refs.imm.estimator, ekf: refs.ekf.estimator },
      rule: "score = min over both references of the smallest G5 margin; largest score; ties within 0.005 to the larger k, then the larger M; reference = the one with the smaller margin (ties: EKF); carried if score > 0",
      medians: {
        imm: medians((r) => r.imm),
        ekf: medians((r) => r.ekf),
        t2: medians((r) => r.t2),
        frozen_fused: medians((r) => r.frozen),
        chosen: medians((r) => r.v[table.indexOf(chosen)]),
      },
      frozen_fused: {
        estimator: frozen.estimator,
        vs: { imm: against((r) => r.frozen, "imm"), ekf: against((r) => r.frozen, "ekf") },
      },
      variants: table,
      best_score: best,
      chosen: chosen.estimator,
      reference: refs[reference].estimator,
      carried: chosen.score > 0,
    },
    null,
    2,
  ),
);
