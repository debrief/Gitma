// Spec 019 (SRD Annex C §C.14; reported, not gated): the clean comparison. The same seed is
// generated twice: once with the phase-7 ranges (realistic bearing error) and once with the
// phase-4 ranges ("clean"). Generator 0.6.0 keeps the geometry and white noise, so the G5 rows are
// identical and only the added error differs. On the G5 rows (all, and settled) it reports, for
// median range error (relative) and median course error:
//   - each tracker's realistic/clean ratio of medians;
//   - the interaction (tracker/reference, realistic) ÷ (tracker/reference, clean).
// Each comes with a scenario-clustered bootstrap 95% interval (2,000 resamples, seed 20261011,
// percentile). A row with no converged estimate has error +∞, as in G5.
// The script was committed before seed 217's validation was scored. Seed 218's clean regeneration
// is scored only after the seed-218 G5 verdict is committed.
//   node scripts/research/spec019-clean.mjs <real.f32pack> <clean.f32pack> \
//     <tracker-real.ndjson> <reference-real.ndjson> <tracker-clean.ndjson> <reference-clean.ndjson>
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";
import { createRng, uniformInt } from "../../packages/sim/dist/prng.js";

const [realPath, cleanPath, ...files] = process.argv.slice(2);
if (files.length !== 4) {
  console.error(
    "usage: spec019-clean.mjs <real.f32pack> <clean.f32pack> <tracker-real> <reference-real> <tracker-clean> <reference-clean>",
  );
  process.exit(2);
}
const [tr, rr, tc, rc] = [
  openPredictionSet(files[0], realPath),
  openPredictionSet(files[1], realPath),
  openPredictionSet(files[2], cleanPath),
  openPredictionSet(files[3], cleanPath),
];
if (tr.estimator !== tc.estimator || rr.estimator !== rc.estimator)
  throw new Error("the realistic and clean files must be the same two estimators");
const METRICS = ["range_rel", "course_deg"];
const RESAMPLES = 2000;
const SEED = 20261011n;

const errorAt = (set, s, k, m) => {
  const p = set.byIndex.get(s.metadata.index);
  if (p === undefined) throw new Error(`${set.label}: no prediction for ${s.metadata.index}`);
  const dt = s.metadata.parameters.dt_s;
  const r = p.rows.find((x) => Math.round(x.timestamp_s / dt) === k);
  return r === undefined || !r.converged ? Infinity : rowError(s, r)[m];
};

// Rows: [cluster, settled, then per metric: tracker-real, reference-real, tracker-clean, reference-clean].
const rows = [];
const cleanIt = scenarioSource(cleanPath)[Symbol.iterator]();
let cluster = 0;
for (const s of scenarioSource(realPath)) {
  const c = cleanIt.next().value;
  if (c === undefined || c.metadata.index !== s.metadata.index)
    throw new Error(`scenario ${s.metadata.index}: the two files are not the same scenarios`);
  if (JSON.stringify(c.target) !== JSON.stringify(s.target))
    throw new Error(`scenario ${s.metadata.index}: geometry differs between the files`);
  const rs = g5Rows([s]);
  if (rs.length === 0) continue;
  for (const r of rs) {
    const e = [];
    for (const m of METRICS)
      e.push(
        errorAt(tr, s, r.k, m),
        errorAt(rr, s, r.k, m),
        errorAt(tc, c, r.k, m),
        errorAt(rc, c, r.k, m),
      );
    rows.push({ cluster, settled: r.settled, e });
  }
  cluster++;
}

const median = (a) => {
  const b = Float64Array.from(a).sort();
  const n = b.length;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
};
/** The statistics of one row set for metric j: [tracker r/c, reference r/c, interaction]. */
const stats = (set, j) => {
  const col = (i) => set.map((r) => r.e[4 * j + i]);
  const [a, b, c, d] = [0, 1, 2, 3].map((i) => median(col(i)));
  return [a / c, b / d, a / b / (c / d)];
};
const quantile = (v, p) => {
  const b = Float64Array.from(v).sort();
  return b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))];
};

const out = [];
for (const [name, subset] of [
  ["all", rows],
  ["settled", rows.filter((r) => r.settled)],
]) {
  const byCluster = new Map();
  for (const r of subset) {
    const l = byCluster.get(r.cluster) ?? [];
    l.push(r);
    byCluster.set(r.cluster, l);
  }
  const groups = [...byCluster.values()];
  METRICS.forEach((m, j) => {
    const point = stats(subset, j);
    const rng = createRng(SEED);
    const draws = point.map(() => []);
    for (let b = 0; b < RESAMPLES; b++) {
      const sample = [];
      for (let i = 0; i < groups.length; i++)
        sample.push(...groups[uniformInt(rng, groups.length)]);
      stats(sample, j).forEach((v, i) => draws[i].push(v));
    }
    const names = [
      `${tr.estimator} realistic/clean`,
      `${rr.estimator} realistic/clean`,
      "interaction (tracker/reference realistic ÷ clean)",
    ];
    names.forEach((stat, i) =>
      out.push({
        rows: name,
        n: subset.length,
        scenarios: groups.length,
        metric: m,
        statistic: stat,
        value: point[i],
        ci95: [quantile(draws[i], 0.025), quantile(draws[i], 0.975)],
      }),
    );
  });
}
console.log(
  JSON.stringify(
    { resamples: RESAMPLES, seed: SEED.toString(), level: 0.95, results: out },
    null,
    2,
  ),
);
