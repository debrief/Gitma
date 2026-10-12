// Seeds a resume state so tma-train continues a committed model (SRD §5 amendment 2026-10-12;
// protocol in experiments/20261011-g1-r2/review.md). Usage:
//   node scripts/train-continue.mjs <committed model dir> <config.json> <out dir>
// The committed weights are the run's best epoch; later epochs are dropped so training resumes
// right after it with the same epoch-indexed batch order. Refuses if the weights do not match the
// manifest digest or the config differs from the run's in anything but max_wall_s.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src, configPath, out] = process.argv.slice(2);
if (!src || !configPath || !out) {
  console.error("usage: train-continue.mjs <model dir> <config.json> <out dir>");
  process.exit(2);
}
if (existsSync(join(out, "manifest.json"))) {
  console.error(`${out} already holds a run: not seeding`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (sha(join(src, "weights.bin")) !== manifest.weights_digest) fail("weights digest mismatch");
const strip = ({ max_wall_s: _, ...rest }) => JSON.stringify(rest, Object.keys(rest).sort());
if (strip(manifest.config) !== strip(config)) fail("config differs in more than max_wall_s");

const best = manifest.best_epoch;
const epochs = manifest.epochs.filter((e) => e.epoch <= best);
if (epochs.length !== best + 1) fail("epoch records do not cover 0..best_epoch");
for (const d of ["checkpoint", "best"]) {
  mkdirSync(join(out, d), { recursive: true });
  for (const f of ["model.json", "weights.bin"]) copyFileSync(join(src, f), join(out, d, f));
}
const { stop_reason: _stop, ...rest } = manifest;
const seeded = { ...rest, config, epochs, complete: false, wall_s: epochs.at(-1).seconds };
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(seeded, null, 2)}\n`);
console.log(
  `seeded ${manifest.id}: resume after epoch ${String(best)} (dropped ${String(manifest.epochs.length - epochs.length)} later epoch(s)); weights ${manifest.weights_digest}`,
);
