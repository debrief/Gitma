import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson, fileSha256, isMain, readDataset, runCli, UsageError } from "@tma/data";
import { FeatureSet, NormalisationConstants, parseRecord } from "@tma/types";
import { createHash } from "node:crypto";
import { writeFeatures } from "./features-file.js";
import { computeNormalisation } from "./normalise.js";

const USAGE =
  "usage: tma-features norm --train <train> [--feature-set raw|derived] --out <norm.json>\n       tma-features build --in <split> --norm <norm.json> [--feature-set raw|derived] --out <split.features.bin>";

function featureSet(text: string): FeatureSet {
  const r = FeatureSet.safeParse(text);
  if (!r.success) throw new UsageError(`bad --feature-set "${text}": expected raw or derived`);
  return r.data;
}

export function main(argv: string[]): unknown {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    strict: true,
    options: {
      train: { type: "string" },
      in: { type: "string" },
      norm: { type: "string" },
      out: { type: "string" },
      "feature-set": { type: "string", default: "raw" },
    },
  });
  const fs = featureSet(values["feature-set"]);
  if (command === "norm" && values.train !== undefined && values.out !== undefined) {
    const ds = readDataset(values.train);
    const digest = createHash("sha256").update(canonicalJson(ds.header)).digest("hex");
    const norm = computeNormalisation(ds.scenarios(), digest, fs);
    const tmp = `${values.out}.tmp-${String(process.pid)}`;
    writeFileSync(tmp, `${canonicalJson(norm)}\n`);
    renameSync(tmp, values.out);
    return norm;
  }
  if (
    command === "build" &&
    values.in !== undefined &&
    values.norm !== undefined &&
    values.out !== undefined
  ) {
    const norm = parseRecord(
      NormalisationConstants,
      JSON.parse(readFileSync(values.norm, "utf8")),
      values.norm,
      "norm",
    );
    const ds = readDataset(values.in);
    // Refuses (exit 2) a norm file without the constants the feature set needs.
    const n = writeFeatures(
      values.out,
      () => ds.scenarios(),
      norm,
      { header: ds.header, digest: fileSha256(values.in) },
      fs,
    );
    return { out: values.out, scenarios: n, feature_set: fs };
  }
  throw new UsageError(USAGE);
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
