// Spec 018 (reported, not gated; G7 panel): coverage of each tracker's calibrated intervals by
// regime on the G5 rows, at the frozen multipliers of a decision. Also:
// - the share of course rows whose 90% interval is vacuous (half-width ≥ 180°), and coverage
//   without them (rows with no estimate are left out of that denominator);
// - speed intervals with a negative lower bound;
// - widths at the median and P90.
// Streams the truth one scenario at a time, so a 110,000-scenario split fits in memory.
//   node scripts/research/spec018-regimes.mjs <test.f32pack> <decision.json> <tracker.ndjson> <reference.ndjson>
import { readFileSync } from "node:fs";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { errorAndSd } from "../../packages/eval/dist/gate-g7.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, decisionPath, ...files] = process.argv.slice(2);
const cal = JSON.parse(readFileSync(decisionPath, "utf8")).calibrations;
const OUTPUTS = ["log_range", "course", "speed"];
const GROUPS = [
  ["all", () => true],
  ["settled", (r) => r.settled],
  ["not settled", (r) => !r.settled],
  ["settled, before any manoeuvre", (r) => r.settled && !r.after],
  ["settled, after a manoeuvre", (r) => r.settled && r.after],
  ...[5, 10, 15, 20].map((t) => [`zig+${t}min`, (r) => r.minutes === t]),
];
const sets = files.map((f) => openPredictionSet(f, truth));
const calOf = (set, o) => {
  const c = cal.find((x) => x.estimator === set.estimator && x.output === o);
  if (!c) throw new Error(`no calibration for ${set.estimator} ${o}`);
  return c;
};
// Per set and output: per-row { e, sd } (or null), and row flags; kept compact.
const flags = [];
const per = sets.map(() => Object.fromEntries(OUTPUTS.map((o) => [o, []])));
const speeds = sets.map(() => []);
for (const s of scenarioSource(truth)) {
  const rows = g5Rows([s]);
  if (rows.length === 0) continue;
  const dt = s.metadata.parameters.dt_s;
  const after = (k) => (s.metadata.manoeuvres ?? []).some((m) => m.end_index <= k);
  for (const r of rows) flags.push({ settled: r.settled, minutes: r.minutes, after: after(r.k) });
  sets.forEach((set, i) => {
    const p = set.byIndex.get(s.metadata.index);
    for (const r of rows) {
      const row = p?.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
      for (const o of OUTPUTS) per[i][o].push(errorAndSd(s, r.k, row, o));
      speeds[i].push(row?.converged ? row.speed_mps : null);
    }
  });
}
const q = (a, p) => {
  const b = Float64Array.from(a).sort();
  return b.length ? b[Math.floor(p * (b.length - 1))] : null;
};
const out = [];
sets.forEach((set, i) => {
  for (const o of OUTPUTS) {
    const c = calOf(set, o);
    const x = per[i][o];
    for (const [name, pred] of GROUPS) {
      const idx = [];
      flags.forEach((f, j) => {
        if (pred(f)) idx.push(j);
      });
      const cov = (m) =>
        idx.filter((j) => x[j] && Math.abs(x[j].e) <= m * x[j].sd).length / idx.length;
      out.push({
        estimator: set.estimator,
        output: o,
        rows: name,
        n: idx.length,
        coverage_50: cov(c.q50),
        coverage_90: cov(c.q90),
      });
    }
    const unit = o === "course" ? 180 / Math.PI : o === "speed" ? 3600 / 1852 : 1;
    const w = x.map((v) => (v ? 2 * c.q90 * v.sd * unit : Infinity));
    const extra = {
      estimator: set.estimator,
      output: o,
      rows: "widths (90%)",
      n: x.length,
      width_median: q(w, 0.5),
      width_p90: q(w, 0.9),
    };
    if (o === "course") {
      const vac = x.map((v) => (v ? c.q90 * v.sd >= Math.PI : false));
      const keep = x.map((v, j) => (v && !vac[j] ? j : -1)).filter((j) => j >= 0);
      extra.vacuous_90_share = vac.filter(Boolean).length / x.length;
      extra.coverage_90_without_vacuous =
        keep.filter((j) => Math.abs(x[j].e) <= c.q90 * x[j].sd).length / keep.length;
      extra.coverage_90_without_vacuous_convention =
        "rows with no estimate left out of the denominator";
    }
    if (o === "speed")
      extra.negative_lower_90_share =
        x.filter((v, j) => v && speeds[i][j] - c.q90 * v.sd < 0).length / x.length;
    out.push(extra);
  }
});
console.log(JSON.stringify(out, null, 2));
