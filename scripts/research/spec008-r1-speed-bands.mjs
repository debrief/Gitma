// Spec 008 R1: iteration-3 LSTM and classical speed error at zig+600 s (σ=1°), by true target speed.
import { readFileSync } from "node:fs";
import { readPack } from "../../packages/data/dist/index.js";
const [pack, ...preds] = process.argv.slice(2);
const ds = readPack(pack);
const KT = 1.943844;
const truth = new Map();
for (const s of ds.scenarios()) truth.set(s.metadata.index, s);
const bands = [
  [0, 5],
  [5, 10],
  [10, 15],
  [15, 17.5],
  [17.5, 20.1],
];
const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN;
};
for (const file of preds) {
  const name = file.split("/").pop();
  const acc = bands.map(() => ({ abs: [], signed: [] }));
  const all = [];
  const recs = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const p = JSON.parse(line);
    const s = truth.get(p.scenario_index);
    if (!s || Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6) continue;
    const k = s.metadata.zig_index + 60;
    if (k >= s.metadata.samples) continue;
    const t = s.metadata.zig_index + 1;
    const row = p.rows[k - t];
    if (!row || !row.converged) continue;
    const v = s.target.states[k].speed_mps * KT;
    const e = (row.speed_mps - s.target.states[k].speed_mps) * KT;
    all.push(Math.abs(e));
    recs.push({ v, e });
    const bi = bands.findIndex(([a, b]) => v >= a && v < b);
    acc[bi].abs.push(Math.abs(e));
    acc[bi].signed.push(e);
  }
  // Oracle de-bias: subtract each 1-kt true-speed bin's median signed error (upper bound on what removing shrinkage gives).
  const bins = new Map();
  for (const r of recs) {
    const b = Math.floor(r.v);
    if (!bins.has(b)) bins.set(b, []);
    bins.get(b).push(r.e);
  }
  const bias = new Map([...bins].map(([b, es]) => [b, median(es)]));
  const deb = recs.map((r) => Math.abs(r.e - bias.get(Math.floor(r.v))));
  console.log(`${name}: de-biased (oracle, per 1-kt bin) median |e| ${median(deb).toFixed(2)} kt`);
  console.log(`${name}: all n ${all.length} median |e| ${median(all).toFixed(2)} kt`);
  bands.forEach(([a, b], i) =>
    console.log(
      `  ${a}-${b} kt: n ${acc[i].abs.length}, median |e| ${median(acc[i].abs).toFixed(2)}, median signed ${median(acc[i].signed).toFixed(2)}`,
    ),
  );
}
