// Seeds a resume state so tma-train continues a committed model (SRD §5 amendment 2026-10-12;
// protocol in experiments/20261011-g1-r2/review.md; spec 003 phase B, decision 14). Usage:
//   node scripts/train-continue.mjs <committed model dir> <config.json> <out dir> \
//     [--allow max_epochs,patience] [--train <train.features.bin> --val <validation.features.bin>]
// The committed weights are the run's best epoch; later epochs are dropped so training resumes
// right after it with the same epoch-indexed batch order. Refuses if the weights do not match the
// manifest digest or the config differs from the run's in anything but max_wall_s and the keys
// named by --allow (the declared change).
//
// --train/--val: the features files this job built. Features files embed the dataset header,
// which names the generating commit, so files rebuilt at a later commit differ in digest even
// when the data are the same. The script checks that they are the same data (identical source
// header apart from the generator commit and dirty flag, identical normalisation apart from the
// header digest; the plan's content digests already pinned the scenarios) and then records these
// files' digests, so tma-train's resume check compares against them.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { allow: { type: "string" }, train: { type: "string" }, val: { type: "string" } },
});
const [src, configPath, out] = positionals;
if (!src || !configPath || !out || (values.train === undefined) !== (values.val === undefined)) {
  console.error(
    "usage: train-continue.mjs <model dir> <config.json> <out dir> [--allow k1,k2] [--train f --val f]",
  );
  process.exit(2);
}
const allowed = new Set(["max_wall_s", ...(values.allow ?? "").split(",").filter(Boolean)]);
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
const strip = (c) => {
  const kept = Object.fromEntries(Object.entries(c).filter(([k]) => !allowed.has(k)));
  return JSON.stringify(kept, Object.keys(kept).sort());
};
if (strip(manifest.config) !== strip(config)) {
  fail(`config differs in more than ${[...allowed].join(", ")}`);
}

const best = manifest.best_epoch;
const epochs = manifest.epochs.filter((e) => e.epoch <= best);
if (epochs.length !== best + 1) fail("epoch records do not cover 0..best_epoch");
for (const d of ["checkpoint", "best"]) {
  mkdirSync(join(out, d), { recursive: true });
  for (const f of ["model.json", "weights.bin"]) copyFileSync(join(src, f), join(out, d, f));
}
// best_val_loss is dropped: tma-train re-scores the source's best weights under the new config's
// loss when it resumes without optimizer state, and records that value (schema 0.8.2).
const { stop_reason: _stop, best_val_loss: _best, ...rest } = manifest;
const seeded = {
  ...rest,
  config,
  epochs,
  complete: false,
  wall_s: epochs.at(-1).seconds,
  continued_from: {
    weights_digest: manifest.weights_digest,
    best_epoch: best,
    val_loss: epochs.at(-1).val_loss,
    ...(typeof manifest.git_commit === "string" ? { git_commit: manifest.git_commit } : {}),
  },
};
if (values.train !== undefined && values.val !== undefined) {
  const { openFeatures } = await import(
    new URL("../packages/features/dist/index.js", import.meta.url).href
  );
  const sameKeys = (a, b, ignore) => {
    const norm = (o) => {
      const kept = Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !ignore.includes(k)));
      return JSON.stringify(kept, Object.keys(kept).sort());
    };
    return norm(a) === norm(b);
  };
  const train = openFeatures(values.train);
  try {
    const header = train.source?.header;
    if (header === undefined) fail("--train has no embedded source header (format 1)");
    if (
      !sameKeys(header, manifest.source_dataset_header, [
        "generator_git_commit",
        "generator_git_dirty",
      ])
    )
      fail("--train comes from another dataset than the committed model's");
    if (!sameKeys(train.norm, manifest.normalisation, ["train_header_digest"]))
      fail("--train normalisation differs from the committed model's");
    seeded.source_dataset_header = header;
    seeded.normalisation = train.norm;
  } finally {
    train.close();
  }
  seeded.train_features_digest = sha(values.train);
  seeded.val_features_digest = sha(values.val);
}
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(seeded, null, 2)}\n`);
console.log(
  `seeded ${manifest.id}: resume after epoch ${String(best)} (dropped ${String(manifest.epochs.length - epochs.length)} later epoch(s)); weights ${manifest.weights_digest}`,
);
