// Spec 028 (SRD Annex F §F.3): one prediction file's errors on the G5 rows of a split, compact, so
// that the 96-variant grid can be scored without keeping every per-timestep file on disk. Rows are
// in the order of scenarioSource(truth) then g5Rows; `keys` is the SHA-256 of that row list, which
// spec028-fuse-grid.mjs checks against its own. A row with no converged estimate is null (+∞ in G5).
// With `--settled` in place of a file it writes each row's settled flag (1 or 0) instead.
//   node scripts/research/spec028-rows.mjs <truth.f32pack> <pred.ndjson>|--settled > <rows.json>
import { createHash } from "node:crypto";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { openPredictionSet, scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, path] = process.argv.slice(2);
if (!truth || !path) {
  console.error("usage: spec028-rows.mjs <truth> <pred.ndjson>");
  process.exit(2);
}
const flags = path === "--settled";
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
      rows.push(r.settled ? 1 : 0);
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
  JSON.stringify({ estimator: flags ? "settled" : set.estimator, keys: keys.digest("hex"), rows }) +
    "\n",
);
