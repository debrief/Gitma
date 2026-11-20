// Spec 032 (SRD Annex J §J.3): the time-late network against every candidate classical reference,
// applied mechanically. On the G5 rows of a validation split, against each candidate (the tuned EKF
// smoother, the tuned IMM smoother, Annex E's re-tuned forward EKF and IMM), six point ratios of
// medians: overall range and course (limit 1); settled range, course and speed (limit 1.1); and
// course on settled rows before any manoeuvre (limit 1.1). A check's margin is
// (limit − point) / limit; a candidate's margin is its smallest. The gate's reference is the
// candidate with the smallest margin (ties: the order given); the network is carried if that
// margin is above 0. Inputs are spec029-rows.mjs outputs with the same keys. Prints JSON.
//   node scripts/research/spec032-select.mjs <network rows> <flags> --ref <rows>... [--also <rows>...]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const [netPath, flagsPath] = args;
const refs = [];
const also = [];
let mode = null;
for (const a of args.slice(2)) {
  if (a === "--ref" || a === "--also") mode = a;
  else if (mode === "--ref") refs.push(a);
  else if (mode === "--also") also.push(a);
}
if (!netPath || !flagsPath || refs.length === 0) {
  console.error("usage: spec032-select.mjs <network> <flags> --ref <rows>... [--also <rows>...]");
  process.exit(2);
}
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const net = load(netPath);
const flags = load(flagsPath);
const R = refs.map(load);
const A = also.map(load);
for (const x of [flags, ...R, ...A])
  if (x.keys !== net.keys) throw new Error(`${x.estimator}: G5 rows differ from the network's`);
const INF = [Infinity, Infinity, Infinity];
const val = (set, i) => set.rows[i] ?? INF;
const all = net.rows.map((_, i) => i);
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
const against = (ref) => {
  const points = CHECKS.map(([check, idx, j, limit]) => {
    const point = med(net, idx, j) / med(ref, idx, j);
    return { check, point, limit, margin: (limit - point) / limit };
  });
  return { reference: ref.estimator, points, margin: Math.min(...points.map((p) => p.margin)) };
};
const medians = (set) =>
  Object.fromEntries(
    [
      ["all", all],
      ["settled", settled],
      ["straight", straight],
    ].map(([n, idx]) => [n, [0, 1, 2].map((j) => med(set, idx, j))]),
  );
const vs = R.map(against);
let k = 0;
vs.forEach((v, i) => {
  if (v.margin < (vs[k]?.margin ?? Infinity)) k = i;
});
const chosen = vs[k];
console.log(
  JSON.stringify(
    {
      network: net.estimator,
      rows: all.length,
      settled_rows: settled.length,
      straight_rows: straight.length,
      rule: "six checks (G5's five and straight-leg course, limit 1.1) against each candidate; reference = the smallest margin (ties: order given); carried if that margin > 0",
      medians: Object.fromEntries([net, ...R, ...A].map((x) => [x.estimator, medians(x)])),
      against: vs,
      reference: chosen.reference,
      margin: chosen.margin,
      carried: chosen.margin > 0,
    },
    null,
    2,
  ),
);
