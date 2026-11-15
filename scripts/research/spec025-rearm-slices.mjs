// Spec 025 §D.7 (reported after the re-arm grid): where the re-armed composite's rows come from
// (least squares, the fused tracker, or a re-armed leg) and its medians on straight-leg rows,
// rows after a manoeuvre, settled rows after a manoeuvre, and all G5 rows, beside the first
// design at the same (W, c) and the fused tracker.
//   node scripts/research/spec025-rearm-slices.mjs <truth> <lsq.ndjson> <fused.ndjson> <out.json> W c L sd
import { writeFileSync } from "node:fs";
import { compositePredict } from "../../packages/classical/dist/index.js";
import { errorOf, g5Rows, rowAt } from "../../packages/eval/dist/gate-g5.js";
import { straightRow } from "../../packages/eval/dist/gate-g9.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, lsqPath, fusedPath, out, W, c, L, sd] = process.argv.slice(2);
const lsq = openPredictionSet(lsqPath, truth);
const fused = openPredictionSet(fusedPath, truth);
const rows = g5Rows(Array.from(scenarioSource(truth)));
const scen = [...new Set(rows.map((r) => r.s))];
const median = (xs) => {
  const b = Float64Array.from(xs).sort();
  return b[Math.floor((b.length - 1) / 2)];
};
const build = (p) => {
  const byIndex = new Map();
  const source = new Map();
  for (const s of scen) {
    const id = s.metadata.index;
    const pc = lsq.byIndex.get(id);
    const pf = fused.byIndex.get(id);
    const fset = new Set(pf.rows);
    const q = compositePredict(s, pc, pf, p);
    byIndex.set(id, q);
    q.rows.forEach((r, i) =>
      source.set(
        `${id}:${r.timestamp_s}`,
        r === pc.rows[i] ? "lsq" : fset.has(r) ? "fused" : "leg",
      ),
    );
  }
  return { set: { label: "c", estimator: "c", byIndex }, source };
};
const p1 = { window: Number(W), threshold: Number(c) };
const v1 = build(p1);
const v2 = build({ ...p1, leg: Number(L), priorSd: Number(sd) });
const after = (r) => (r.s.metadata.manoeuvres ?? []).some((m) => m.end_index <= r.k);
const slices = {
  straight: rows.filter(straightRow),
  after: rows.filter(after),
  "settled-after": rows.filter((r) => r.settled && after(r)),
  all: rows,
};
const M = ["range_rel", "course_deg", "speed_kt"];
const res = { params: { ...p1, leg: Number(L), priorSd: Number(sd) }, slices: {} };
for (const [n, rs] of Object.entries(slices)) {
  const share = {};
  for (const r of rs) {
    const k = v2.source.get(`${r.s.metadata.index}:${r.k * r.s.metadata.parameters.dt_s}`);
    share[k] = (share[k] ?? 0) + 1 / rs.length;
  }
  const legRows = rs.filter(
    (r) => v2.source.get(`${r.s.metadata.index}:${r.k * r.s.metadata.parameters.dt_s}`) === "leg",
  );
  res.slices[n] = {
    n: rs.length,
    rearmed_row_sources: share,
    medians: Object.fromEntries(
      M.map((m) => [
        m,
        {
          rearmed: median(rs.map((r) => errorOf(r.s, rowAt(v2.set, r.s, r.k), m))),
          first_design: median(rs.map((r) => errorOf(r.s, rowAt(v1.set, r.s, r.k), m))),
          fused: median(rs.map((r) => errorOf(r.s, rowAt(fused, r.s, r.k), m))),
        },
      ]),
    ),
    leg_rows: {
      n: legRows.length,
      ...Object.fromEntries(
        M.map((m) => [
          m,
          {
            leg: median(legRows.map((r) => errorOf(r.s, rowAt(v2.set, r.s, r.k), m))),
            fused_same_rows: median(legRows.map((r) => errorOf(r.s, rowAt(fused, r.s, r.k), m))),
          },
        ]),
      ),
    },
  };
}
writeFileSync(out, `${JSON.stringify(res, null, 2)}\n`);
console.log(JSON.stringify(res.slices, null, 1).slice(0, 6000));
