// Spec 029 (SRD Annex G §G.3; from spec028-rows.mjs): one prediction file's errors on the G5 rows of a split, compact, so
// that the 96-variant grid can be scored without keeping every per-timestep file on disk. Rows are
// in the order of scenarioSource(truth) then g5Rows; `keys` is the SHA-256 of that row list, which
// spec029-fuse-grid.mjs checks against its own. A row with no converged estimate is null (+∞ in G5).
// With `--flags` in place of a file it writes each row's flags: 1 settled, 2 settled before any manoeuvre.
//   node scripts/research/spec029-rows.mjs <truth.f32pack> <pred.ndjson>|--flags > <rows.json>
import { createHash } from "node:crypto";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows, straightRow } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, path] = process.argv.slice(2);
if (!truth || !path) {
  console.error("usage: spec029-rows.mjs <truth> <pred.ndjson>");
  process.exit(2);
}
const flags = path === "--flags";
const set = flags ? null : openPredictionSet(path, truth);
const keys = createHash("sha256");
const rows = [];
for (const s of scenarioSource(truth)) {
  const p = flags ? null : set.byIndex.get(s.metadata.index);
  if (!flags && p === undefined) throw new Error(`${path}: no prediction for ${s.metadata.index}`);
  const dt = s.metadata.parameters.dt_s;
  for (const r of g5Rows([s])) {
    keys.update(`${s.metadata.index}:${r.k}:${r.settled ? 1 : 0};`);
    if (flags) {
      rows.push(straightRow(s.metadata, r.k) ? 2 : r.settled ? 1 : 0);
      continue;
    }
    const q = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
    if (q === undefined || !q.converged) rows.push(null);
    else {
      const e = rowError(s, q);
      rows.push([e.range_rel, e.course_deg, e.speed_kt]);
    }
  }
}
process.stdout.write(
  JSON.stringify({ estimator: flags ? "flags" : set.estimator, keys: keys.digest("hex"), rows }) +
    "\n",
);
