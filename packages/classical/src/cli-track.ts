import { closeSync, openSync, renameSync, writeSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson, isMain, readDataset, runCli, UsageError } from "@tma/data";
import type { Prediction, Scenario } from "@tma/types";
import { ekfName, ekfPredict } from "./ekf.js";
import { type ImmParams, immName, immPredict } from "./imm.js";
import { predictionHeader } from "./predictions.js";

/** A non-negative number option, or a usage error naming it. */
function num(values: Record<string, unknown>, key: string): number {
  const v = Number(values[key]);
  if (values[key] === undefined || !Number.isFinite(v) || v < 0)
    throw new UsageError(`--${key} must be a number ≥ 0`);
  return v;
}

/**
 * Tracking-filter predictions (spec 010): per-timestep rows from zig_index + 1, as
 * `tma-solve --per-timestep`, from the EKF (`--filter ekf --sigma-a`) or the IMM
 * (`--filter imm --sigma-cv --sigma-ct --sigma-omega --switch`). Written as made.
 */
export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      in: { type: "string" },
      out: { type: "string" },
      filter: { type: "string" },
      "sigma-a": { type: "string" },
      "sigma-cv": { type: "string" },
      "sigma-ct": { type: "string" },
      "sigma-omega": { type: "string" },
      switch: { type: "string" },
    },
  });
  if (values.in === undefined || values.out === undefined)
    throw new UsageError(
      "usage: tma-track --in <split.f32pack> --out <pred.ndjson> " +
        "(--filter ekf --sigma-a <m/s²> | --filter imm --sigma-cv <m/s²> --sigma-ct <m/s²> " +
        "--sigma-omega <rad/s/√s> --switch <1/s>)",
    );
  let name: string;
  let predict: (s: Scenario) => Prediction;
  if (values.filter === "ekf") {
    const sigmaA = num(values, "sigma-a");
    name = ekfName(sigmaA);
    predict = (s) => ekfPredict(s, sigmaA);
  } else if (values.filter === "imm") {
    const p: ImmParams = {
      sigmaCv: num(values, "sigma-cv"),
      sigmaCt: num(values, "sigma-ct"),
      sigmaOmega: num(values, "sigma-omega"),
      switchPerS: num(values, "switch"),
    };
    name = immName(p);
    predict = (s) => immPredict(s, p);
  } else throw new UsageError("--filter must be ekf or imm");
  const t0 = performance.now();
  const ds = readDataset(values.in);
  const tmp = `${values.out}.tmp-${String(process.pid)}`;
  const fd = openSync(tmp, "w");
  let scenarios = 0;
  let nonConvergedRows = 0;
  try {
    writeSync(fd, `${canonicalJson(predictionHeader(name, "per_timestep", values.in))}\n`);
    for (const s of ds.scenarios()) {
      const p = predict(s);
      nonConvergedRows += p.rows.filter((r) => !r.converged).length;
      writeSync(fd, `${canonicalJson(p)}\n`);
      scenarios++;
    }
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, values.out);
  return {
    out: values.out,
    estimator: name,
    scenarios,
    non_converged_rows: nonConvergedRows,
    seconds: (performance.now() - t0) / 1000,
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
