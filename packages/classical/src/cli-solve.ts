import { writeFileSync, renameSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import type { Prediction } from "@tma/types";
import { CLASSICAL, classicalPredict } from "./estimate.js";
import { predictionHeader, predictionLines } from "./predictions.js";

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      in: { type: "string" },
      out: { type: "string" },
      "per-timestep": { type: "boolean", default: false },
      "max-iter": { type: "string", default: "50" },
      "grid-every": { type: "string", default: "6" },
    },
  });
  if (values.in === undefined || values.out === undefined) {
    throw new UsageError(
      "usage: tma-solve --in <test.f32pack> --out <pred.ndjson> [--per-timestep] [--max-iter n]",
    );
  }
  const maxIterations = Number(values["max-iter"]);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new UsageError("bad --max-iter");
  const gridEvery = Number(values["grid-every"]);
  if (!Number.isInteger(gridEvery) || gridEvery < 0) throw new UsageError("bad --grid-every");
  const mode = values["per-timestep"] ? "per_timestep" : "final";
  const t0 = performance.now();
  const ds = readDataset(values.in);
  const predictions: Prediction[] = [];
  let nonConverged = 0;
  for (const s of ds.scenarios()) {
    const p = classicalPredict(s, mode, { maxIterations, gridEvery });
    if (p.rows.some((r) => !r.converged)) nonConverged++;
    predictions.push(p);
  }
  const lines = predictionLines(predictionHeader(CLASSICAL, mode, values.in), predictions);
  const tmp = `${values.out}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, `${lines.join("\n")}\n`);
  renameSync(tmp, values.out);
  return {
    out: values.out,
    mode,
    scenarios: predictions.length,
    non_converged: nonConverged,
    seconds: (performance.now() - t0) / 1000,
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
