import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain, UsageError } from "@tma/data";
import { parseRecord, RecordError, TrainingConfig } from "@tma/types";
import { runAsyncCli } from "./cli-run.js";
import { g0Passed } from "./g0-guard.js";
import { train } from "./train.js";

export async function main(argv: string[]): Promise<unknown> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      config: { type: "string" },
      train: { type: "string" },
      val: { type: "string" },
      out: { type: "string" },
      experiments: { type: "string", default: "experiments" },
    },
  });
  if (!values.config || !values.train || !values.val || !values.out) {
    throw new UsageError(
      "usage: tma-train --config <config.json> --train <train.features.bin> --val <validation.features.bin> --out <dir> [--experiments dir]",
    );
  }
  const g0 = g0Passed(values.experiments);
  if (g0 === null) {
    throw new RecordError(
      values.experiments,
      "G0",
      "no passing G0 verdict: training is not allowed (constitution V)",
    );
  }
  const config = parseRecord(
    TrainingConfig,
    JSON.parse(readFileSync(values.config, "utf8")),
    values.config,
    "config",
  );
  const m = await train({
    config,
    trainPath: values.train,
    valPath: values.val,
    outDir: values.out,
  });
  if (m.stop_reason === "diverged") throw new Error(`${config.id}: training diverged`);
  return {
    id: m.id,
    g0_experiment: g0,
    stop_reason: m.stop_reason,
    best_epoch: m.best_epoch,
    epochs: m.epochs.length,
    wall_s: Math.round(m.wall_s),
  };
}

if (isMain(import.meta.url)) runAsyncCli(main, process.argv.slice(2));
