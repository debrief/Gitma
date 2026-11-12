// Spec 022 (G8 panel phase 10, estimation and statistics; reported, not gated): how the gate's
// "non-converged = +∞" convention moves the hybrid's ratios. On the G5 rows of a split, for the
// hybrid, the reference IMM, the fused tracker and T2, per metric (all rows and settled):
//   - non-converged counts;
//   - the gate's medians and ratios (non-converged = +∞, as tma-g5);
//   - ratios on rows where all four converged;
//   - ratios with each reference falling back to T2 where it has no estimate;
// and the rows where the hybrid's range differs from T2's, or its velocity is T2's because the
// fused tracker is not converged. Written by the estimation reviewer; committed for the record.
//   node scripts/research/spec022-convergence.mjs <truth.f32pack> <hybrid> <imm> <fused> <t2>
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, ...files] = process.argv.slice(2);
if (files.length !== 4) {
  console.error("usage: spec022-convergence.mjs <truth> <hybrid> <imm> <fused> <t2>");
  process.exit(2);
}
const names = ["hybrid", "imm", "fused", "t2"];
const sets = files.map((f) => openPredictionSet(f, truth));
const M = ["range_rel", "course_deg", "speed_kt"];
const rows = [];
let nsc = 0;
let rangeMismatch = 0;
let velFromT2 = 0;
let t2NotConverged = 0;
for (const s of scenarioSource(truth)) {
  const rs = g5Rows([s]);
  if (!rs.length) continue;
  nsc++;
  const dt = s.metadata.parameters.dt_s;
  const preds = sets.map((set) => set.byIndex.get(s.metadata.index));
  for (const r of rs) {
    const rw = preds.map((p) => p?.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k));
    const e = rw.map((row) =>
      M.map((m) => (row === undefined || !row.converged ? Infinity : rowError(s, row)[m])),
    );
    const [h, , f, t] = rw;
    if (h && t && h.converged && t.converged && h.range_m !== t.range_m) rangeMismatch++;
    if (f && !f.converged) velFromT2++;
    if (t && !t.converged) t2NotConverged++;
    rows.push({ settled: r.settled, e });
  }
}
const med = (a) => {
  const b = Float64Array.from(a).sort();
  return b[Math.floor(0.5 * (b.length - 1))];
};
const r4 = (x) => +x.toFixed(4);
const out = { scenarios: nsc, rows: rows.length, rangeMismatch, velFromT2, t2NotConverged };
for (const [g, pred] of [
  ["all", () => true],
  ["settled", (r) => r.settled],
]) {
  const sub = rows.filter(pred);
  for (let j = 0; j < 3; j++) {
    const gate = names.map((_, i) => med(sub.map((r) => r.e[i][j])));
    const both = sub.filter((r) => r.e.every((x) => Number.isFinite(x[j])));
    const conv = names.map((_, i) => med(both.map((r) => r.e[i][j])));
    const fb = (i) => med(sub.map((r) => (Number.isFinite(r.e[i][j]) ? r.e[i][j] : r.e[3][j])));
    out[`${g}:${M[j]}`] = {
      non_converged: Object.fromEntries(
        names.map((n, i) => [n, sub.filter((r) => !Number.isFinite(r.e[i][j])).length]),
      ),
      medians: Object.fromEntries(names.map((n, i) => [n, r4(gate[i])])),
      gate: {
        hybrid_imm: r4(gate[0] / gate[1]),
        hybrid_fused: r4(gate[0] / gate[2]),
        hybrid_t2: r4(gate[0] / gate[3]),
      },
      all_converged: {
        rows: both.length,
        hybrid_imm: r4(conv[0] / conv[1]),
        hybrid_fused: r4(conv[0] / conv[2]),
        hybrid_t2: r4(conv[0] / conv[3]),
      },
      reference_falls_back_to_t2: {
        hybrid_imm: r4(gate[0] / fb(1)),
        hybrid_fused: r4(gate[0] / fb(2)),
      },
    };
  }
}
console.log(JSON.stringify(out, null, 2));
