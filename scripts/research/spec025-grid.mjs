// Spec 025 (SRD Annex D §D.2): the composite solver's fit-check grid on validation, and the
// pre-registered selection. For each W (samples) × c (threshold), the composite of the
// per-timestep least-squares file and the frozen fused tracker is built in memory, and the five
// gated G9 point ratios are computed on G5's rows. A variant's score is its smallest margin,
// (limit − point) / limit. The highest score wins; among variants within 0.005 of it, the larger
// c, then the larger W. The winner is carried only if its score is above 0, and its full G9
// diagnostic (with 95% intervals) is reported. Committed before any variant is scored.
//
//   pnpm build
//   node scripts/research/spec025-grid.mjs <truth.f32pack> <lsq.ndjson> <fused.ndjson> <out.json>
import { writeFileSync } from "node:fs";
import { compositePredict } from "../../packages/classical/dist/index.js";
import { errorOf, g5Rows, rowAt } from "../../packages/eval/dist/gate-g5.js";
import {
  G9_RATIO,
  G9_STRAIGHT_RATIO,
  g9Checks,
  g9Verdict,
  straightRow,
} from "../../packages/eval/dist/gate-g9.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

export const WINDOWS = [6, 12, 30, 60];
export const THRESHOLDS = [2, 3, 4, 6, 8, 12];
export const TIE = 0.005;

const [truth, lsqPath, fusedPath, outPath] = process.argv.slice(2);
if (outPath === undefined) {
  console.error("usage: spec025-grid.mjs <truth> <lsq.ndjson> <fused.ndjson> <out.json>");
  process.exit(2);
}
const lsq = openPredictionSet(lsqPath, truth);
const fused = openPredictionSet(fusedPath, truth);
const scenarios = Array.from(scenarioSource(truth));
const rows = g5Rows(scenarios);
const straight = rows.filter(straightRow);
const g5Scen = [...new Set(rows.map((r) => r.s))];
const median = (xs) => {
  const b = Float64Array.from(xs).sort();
  return b[Math.floor((b.length - 1) / 2)];
};
const med = (set, rs, m) => median(rs.map((r) => errorOf(r.s, rowAt(set, r.s, r.k), m)));
const ref = {
  fusedRange: med(fused, rows, "range_rel"),
  fusedCourse: med(fused, rows, "course_deg"),
  lsqRange: med(lsq, straight, "range_rel"),
  lsqCourse: med(lsq, straight, "course_deg"),
  lsqSpeed: med(lsq, straight, "speed_kt"),
};

/** The composite as an in-memory prediction set over the G5 scenarios. */
function compositeSet(p) {
  const byIndex = new Map();
  let fromLsq = 0;
  let total = 0;
  for (const s of g5Scen) {
    const id = s.metadata.index;
    const c = compositePredict(s, lsq.byIndex.get(id), fused.byIndex.get(id), p);
    const pc = lsq.byIndex.get(id);
    c.rows.forEach((r, i) => {
      total++;
      if (r === pc.rows[i]) fromLsq++;
    });
    byIndex.set(id, c);
  }
  const label = `composite-w${p.window}-c${p.threshold}`;
  return { set: { label, estimator: label, byIndex }, shareLsq: fromLsq / total };
}

const variants = [];
for (const window of WINDOWS)
  for (const threshold of THRESHOLDS) {
    const { set, shareLsq } = compositeSet({ window, threshold });
    const points = {
      "g9-range-vs-fused": med(set, rows, "range_rel") / ref.fusedRange,
      "g9-course-vs-fused": med(set, rows, "course_deg") / ref.fusedCourse,
      "g9-straight-range": med(set, straight, "range_rel") / ref.lsqRange,
      "g9-straight-course": med(set, straight, "course_deg") / ref.lsqCourse,
      "g9-straight-speed": med(set, straight, "speed_kt") / ref.lsqSpeed,
    };
    const limit = (k) => (k.startsWith("g9-straight") ? G9_STRAIGHT_RATIO : G9_RATIO);
    const margins = Object.fromEntries(
      Object.entries(points).map(([k, v]) => [k, (limit(k) - v) / limit(k)]),
    );
    const score = Math.min(...Object.values(margins));
    variants.push({ window, threshold, points, margins, score, rows_from_lsq: shareLsq });
    console.log(window, threshold, score.toFixed(4), JSON.stringify(points));
  }
const best = Math.max(...variants.map((v) => v.score));
const chosen = variants
  .filter((v) => v.score >= best - TIE)
  .sort((a, b) => b.threshold - a.threshold || b.window - a.window)[0];
const carried = chosen.score > 0;
const out = {
  truth,
  rows: rows.length,
  straight_rows: straight.length,
  reference_medians: ref,
  variants,
  rule: `max score; within ${TIE}: larger c, then larger W; carried iff score > 0`,
  best_score: best,
  chosen: { window: chosen.window, threshold: chosen.threshold, score: chosen.score },
  carried,
};
// The chosen variant's full G9 diagnostic (95% intervals), reported either way.
const { set } = compositeSet({ window: chosen.window, threshold: chosen.threshold });
const checks = g9Checks(scenarios, set, fused, lsq);
out.chosen_diagnostic = g9Verdict(checks);
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ chosen: out.chosen, carried, best_score: best }));
