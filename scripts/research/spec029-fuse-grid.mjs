// Spec 029 (SRD Annex G §G.3): the selection of the EKF-fused tracker with a range fade and adaptive
// process noise, applied mechanically. Annex F's score plus one check: on the G5 rows of a
// validation split, for each variant and each re-tuned reference (Annex E's IMM and EKF), six point
// ratios of medians: overall range and course (limit 1); settled range, course and speed (limit
// 1.1); and course on settled rows before any manoeuvre (limit 1.1). A check's margin is
// (limit − point) / limit; a variant's score is its smallest margin over both references. The
// carried variant has the largest score, if above 0; ties within 0.005 go to the smaller ceiling
// (adapt hi), then the larger NIS threshold (eta), then the smaller fade. The gate's reference is
// the one the carried variant's margin is smaller against (ties: the EKF). Inputs are
// spec029-rows.mjs outputs with the same row keys. Prints JSON.
//   node scripts/research/spec029-fuse-grid.mjs <imm> <ekf> <t2> <phase15> <flags> <variant>...
import { readFileSync } from "node:fs";
import { parseFusedEkfName } from "../../packages/classical/dist/names.js";

const [immPath, ekfPath, t2Path, p15Path, flagsPath, ...paths] = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: spec029-fuse-grid.mjs <imm> <ekf> <t2> <phase15> <flags> <variant>...");
  process.exit(2);
}
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const refs = { imm: load(immPath), ekf: load(ekfPath) };
const t2 = load(t2Path);
const p15 = load(p15Path);
const flags = load(flagsPath);
const variants = paths.map((p) => {
  const set = load(p);
  const parsed = parseFusedEkfName(set.estimator, t2.estimator);
  if (parsed === null)
    throw new Error(`${p}: ${set.estimator} is not an EKF fusion of ${t2.estimator}`);
  const f = parsed.fusion;
  return {
    set,
    fade: f.fade ?? 0,
    hi: f.adapt?.hi ?? parsed.sigmaA,
    eta: f.adapt?.eta ?? Infinity,
  };
});
for (const x of [refs.imm, refs.ekf, p15, flags, ...variants.map((v) => v.set)])
  if (x.keys !== t2.keys) throw new Error(`${x.estimator}: G5 rows differ from T2's`);
const INF = [Infinity, Infinity, Infinity];
const val = (set, i) => set.rows[i] ?? INF;
const all = t2.rows.map((_, i) => i);
const settled = all.filter((i) => flags.rows[i] >= 1);
const straight = all.filter((i) => flags.rows[i] === 2);
const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b[Math.floor((b.length - 1) / 2)];
};
const med = (set, idx, j) => median(idx.map((i) => val(set, i)[j]));
const CHECKS = [
  ["overall range", all, 0, 1],
  ["overall course", all, 1, 1],
  ["settled range", settled, 0, 1.1],
  ["settled course", settled, 1, 1.1],
  ["settled speed", settled, 2, 1.1],
  ["straight-leg course", straight, 1, 1.1],
];
const against = (set, ref) => {
  const points = CHECKS.map(([check, idx, j, limit]) => {
    const point = med(set, idx, j) / med(ref, idx, j);
    return { check, point, limit, margin: (limit - point) / limit };
  });
  return { points, margin: Math.min(...points.map((p) => p.margin)) };
};
const medians = (set) =>
  Object.fromEntries(
    [
      ["all", all],
      ["settled", settled],
      ["straight", straight],
    ].map(([n, idx]) => [n, [0, 1, 2].map((j) => med(set, idx, j))]),
  );
const table = variants.map((x) => {
  const vs = { imm: against(x.set, refs.imm), ekf: against(x.set, refs.ekf) };
  return {
    estimator: x.set.estimator,
    fade: x.fade,
    hi: x.hi,
    eta: x.eta,
    vs,
    medians: medians(x.set),
    range_vs_t2: med(x.set, all, 0) / med(t2, all, 0),
    score: Math.min(vs.imm.margin, vs.ekf.margin),
  };
});
const best = Math.max(...table.map((t) => t.score));
const chosen = table
  .filter((t) => t.score >= best - 0.005)
  .sort((a, b) => a.hi - b.hi || b.eta - a.eta || a.fade - b.fade)[0];
const reference = chosen.vs.imm.margin < chosen.vs.ekf.margin ? "imm" : "ekf";
console.log(
  JSON.stringify(
    {
      rows: all.length,
      settled_rows: settled.length,
      straight_rows: straight.length,
      references: { imm: refs.imm.estimator, ekf: refs.ekf.estimator },
      rule: "score = min over both references of the smallest margin over six checks (G5's five and straight-leg course, limit 1.1); largest score; ties within 0.005 to the smaller hi, then the larger eta, then the smaller fade; reference = the one with the smaller margin (ties: EKF); carried if score > 0",
      medians: {
        imm: medians(refs.imm),
        ekf: medians(refs.ekf),
        t2: medians(t2),
        phase15: medians(p15),
      },
      phase15: {
        estimator: p15.estimator,
        vs: { imm: against(p15, refs.imm), ekf: against(p15, refs.ekf) },
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
