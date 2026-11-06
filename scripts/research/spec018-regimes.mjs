// Spec 018 (reported, not gated; panel round 1): coverage of each tracker's calibrated intervals
// by regime on the G5 rows, at the frozen multipliers of a decision; the share of course rows
// whose 90% interval is vacuous (half-width ≥ 180°) and coverage without them; speed intervals
// with a negative lower bound; and widths at the median and P90.
//   node scripts/research/spec018-regimes.mjs <test.f32pack> <decision.json> <tracker.ndjson> <reference.ndjson>
import { readFileSync } from "node:fs";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { errorAndSd } from "../../packages/eval/dist/gate-g7.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, decisionPath, ...files] = process.argv.slice(2);
const cal = JSON.parse(readFileSync(decisionPath, "utf8")).calibrations;
const rows = g5Rows(scenarioSource(truth));
const afterManoeuvre = (r) => (r.s.metadata.manoeuvres ?? []).some((m) => m.end_index <= r.k);
const groups = [
  ["all", () => true],
  ["settled", (r) => r.settled],
  ["not settled", (r) => !r.settled],
  ["settled, before any manoeuvre", (r) => r.settled && !afterManoeuvre(r)],
  ["settled, after a manoeuvre", (r) => r.settled && afterManoeuvre(r)],
  ...[5, 10, 15, 20].map((t) => [`zig+${t}min`, (r) => r.minutes === t]),
];
const q = (a, p) =>
  a.length ? a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] : null;
const out = [];
for (const f of files) {
  const set = openPredictionSet(f, truth);
  const dt = (s) => s.metadata.parameters.dt_s;
  const at = (r) =>
    set.byIndex
      .get(r.s.metadata.index)
      ?.rows.find((x) => Math.round(x.timestamp_s / dt(r.s)) === r.k);
  const per = rows.map((r) => {
    const row = at(r);
    return Object.fromEntries(
      ["log_range", "course", "speed"].map((o) => [o, errorAndSd(r.s, r.k, row, o)]),
    );
  });
  for (const output of ["log_range", "course", "speed"]) {
    const c = cal.find((x) => x.estimator === set.estimator && x.output === output);
    if (!c) throw new Error(`no calibration for ${set.estimator} ${output}`);
    for (const [name, pred] of groups) {
      const idx = rows.map((r, i) => (pred(r) ? i : -1)).filter((i) => i >= 0);
      const cov = (m) =>
        idx.filter((i) => {
          const x = per[i][output];
          return x && Math.abs(x.e) <= m * x.sd;
        }).length / idx.length;
      out.push({
        estimator: set.estimator,
        output,
        rows: name,
        n: idx.length,
        coverage_50: cov(c.q50),
        coverage_90: cov(c.q90),
      });
    }
    const unit = output === "course" ? 180 / Math.PI : output === "speed" ? 3600 / 1852 : 1;
    const w = per.map((p) => (p[output] ? 2 * c.q90 * p[output].sd * unit : Infinity));
    const extra = {
      estimator: set.estimator,
      output,
      rows: "widths (90%)",
      n: rows.length,
      width_median: q(w, 0.5),
      width_p90: q(w, 0.9),
    };
    if (output === "course") {
      const vac = per.map((p) => (p.course ? c.q90 * p.course.sd >= Math.PI : false));
      const keep = per.map((p, i) => (p.course && !vac[i] ? i : -1)).filter((i) => i >= 0);
      extra.vacuous_90_share = vac.filter(Boolean).length / rows.length;
      extra.coverage_90_without_vacuous =
        keep.filter((i) => Math.abs(per[i].course.e) <= c.q90 * per[i].course.sd).length /
        keep.length;
    }
    if (output === "speed") {
      const rowsAt = rows.map(at);
      extra.negative_lower_90_share =
        per.filter((p, i) => p.speed && rowsAt[i].speed_mps - c.q90 * p.speed.sd < 0).length /
        rows.length;
    }
    out.push(extra);
  }
}
console.log(JSON.stringify(out, null, 2));
