import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson, isMain, readDataset, runCli, UsageError } from "@tma/data";
import { NormalisationConstants, parseRecord } from "@tma/types";
import { createHash } from "node:crypto";
import { writeFeatures } from "./features-file.js";
import { computeNormalisation } from "./normalise.js";

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
    },
  });
  if (command === "norm" && values.train !== undefined && values.out !== undefined) {
    const ds = readDataset(values.train);
    const digest = createHash("sha256").update(canonicalJson(ds.header)).digest("hex");
    const norm = computeNormalisation(ds.scenarios(), digest);
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
    const n = writeFeatures(values.out, () => ds.scenarios(), norm);
    return { out: values.out, scenarios: n };
  }
  throw new UsageError(
    "usage: tma-features norm --train <train> --out <norm.json>\n       tma-features build --in <split> --norm <norm.json> --out <split.features.bin>",
  );
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
