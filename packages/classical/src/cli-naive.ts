import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson, isMain, readDataset, runCli, UsageError } from "@tma/data";
import { NaiveModel, parseRecord } from "@tma/types";
import { fitNaive, NAIVE, naivePredict } from "./naive.js";
import { fileDigest, predictionHeader, predictionLines } from "./predictions.js";

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function loadNaive(path: string): NaiveModel {
  return parseRecord(NaiveModel, JSON.parse(readFileSync(path, "utf8")), path, "model");
}

export function main(argv: string[]): unknown {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    strict: true,
    options: {
      train: { type: "string" },
      model: { type: "string" },
      in: { type: "string" },
      out: { type: "string" },
      "per-timestep": { type: "boolean", default: false },
    },
  });
  if (command === "fit" && values.train !== undefined && values.out !== undefined) {
    const model = fitNaive(readDataset(values.train).scenarios(), fileDigest(values.train));
    writeAtomic(values.out, `${canonicalJson(model)}\n`);
    return { out: values.out, final_n: model.final.n, per_timestep_n: model.per_timestep.n };
  }
  if (
    command === "predict" &&
    values.model !== undefined &&
    values.in !== undefined &&
    values.out !== undefined
  ) {
    const model = loadNaive(values.model);
    const mode = values["per-timestep"] ? "per_timestep" : "final";
    const ds = readDataset(values.in);
    const preds = [...ds.scenarios()].map((s) => naivePredict(s, model, mode));
    const lines = predictionLines(predictionHeader(NAIVE, mode, values.in), preds);
    writeAtomic(values.out, `${lines.join("\n")}\n`);
    return { out: values.out, mode, scenarios: preds.length };
  }
  throw new UsageError(
    "usage: tma-naive fit --train <train> --out <naive.json>\n" +
      "       tma-naive predict --model <naive.json> --in <split> --out <pred.ndjson> [--per-timestep]",
  );
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
