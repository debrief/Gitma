// Spec 008 re-score (seed 206): speed bias of each estimator at zig+600 s (σ=1°), streamed.
// Median |e|, median signed e, the OLS slope of predicted on true speed, and the R1 speed bands.
// usage: node scripts/research/spec008-rescore-bias.mjs <test.f32pack> <pred.ndjson>...
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readPack } from "../../packages/data/dist/index.js";
const [pack, ...preds] = process.argv.slice(2);
const KT = 1.943844;
// Only what the gate point needs: the row offset and the true speed there.
const truth = new Map();
for (const s of readPack(pack).scenarios()) {
  if (Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6) continue;
  const k = s.metadata.zig_index + 60;
  if (k >= s.metadata.samples) continue;
  truth.set(s.metadata.index, { row: k - (s.metadata.zig_index + 1), v: s.target.states[k].speed_mps });
}
const bands = [
  [0, 5],
  [5, 10],
  [10, 15],
  [15, 17.5],
  [17.5, 20.1],
];
const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN;
};
for (const file of preds) {
  const name = file.split("/").pop();
  const acc = bands.map(() => ({ abs: [], signed: [] }));
  const abs = [];
  const signed = [];
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const p = JSON.parse(line);
    const t = truth.get(p.scenario_index);
    if (!t) continue;
    const row = p.rows[t.row];
    if (!row || !row.converged) continue;
    const v = t.v * KT;
    const y = row.speed_mps * KT;
    const e = y - v;
    abs.push(Math.abs(e));
    signed.push(e);
    sx += v;
    sy += y;
    sxx += v * v;
    sxy += v * y;
    const bi = bands.findIndex(([a, b]) => v >= a && v < b);
    acc[bi].abs.push(Math.abs(e));
    acc[bi].signed.push(e);
  }
  const n = abs.length;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  console.log(
    `${name}: n ${n}, median |e| ${median(abs).toFixed(3)} kt, median signed ${median(signed).toFixed(3)} kt, slope ${slope.toFixed(3)}`,
  );
  bands.forEach(([a, b], i) =>
    console.log(
      `  ${a}-${b} kt: n ${acc[i].abs.length}, median |e| ${median(acc[i].abs).toFixed(2)}, median signed ${median(acc[i].signed).toFixed(2)}`,
    ),
  );
}
