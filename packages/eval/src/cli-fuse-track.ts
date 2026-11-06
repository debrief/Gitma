// tma-fuse-track (spec 014): the fused tracker's per-timestep predictions (fusedPredict in
// @tma/classical): the IMM with a network's range fused in as a measurement. A pipeline stage of
// its own; the IMM's parameters, k and the update interval are part of the estimator name, so a
// gate binds them with the decision. The network's file digest is recorded in the header
// (`inputs`, schema 0.17.0), so tma-g5 can tie the fused file to bound weights.
import { parseArgs } from "node:util";
import {
  FUSION_DEFAULT,
  type FusionParams,
  fileDigest,
  fusedName,
  fusedPredict,
  type ImmParams,
} from "@tma/classical";
import { isMain, runCli, UsageError } from "@tma/data";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-fuse-track --truth <split.f32pack> --network <t2.ndjson> --out <fused.ndjson> " +
  "--sigma-cv <m/s²> --sigma-ct <m/s²> --sigma-omega <rad/s/√s> --switch <1/s> " +
  "[--p0-scale k] [--r-scale k] [--guarded-init 1|2] [--report-sd] [--k 4] [--every 6]";

function num(values: Record<string, unknown>, key: string, positive = false): number {
  const raw = values[key] as string | undefined;
  const v = Number(raw);
  if (raw === undefined || !Number.isFinite(v) || v < 0 || (positive && v === 0))
    throw new UsageError(`--${key} must be a number ${positive ? "> 0" : "≥ 0"}`);
  return v;
}

/** The `--guarded-init` level (spec 016). */
function guardedLevel(v: string): 1 | 2 {
  if (v === "1") return 1;
  if (v === "2") return 2;
  throw new UsageError("--guarded-init must be 1 or 2 (spec 016)");
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      network: { type: "string" },
      out: { type: "string" },
      "sigma-cv": { type: "string" },
      "sigma-ct": { type: "string" },
      "sigma-omega": { type: "string" },
      switch: { type: "string" },
      "p0-scale": { type: "string" },
      "r-scale": { type: "string" },
      "guarded-init": { type: "string" },
      "report-sd": { type: "boolean" },
      k: { type: "string" },
      every: { type: "string" },
    },
  });
  const { truth, network, out } = values;
  if (!truth || !network || !out) throw new UsageError(USAGE);
  const p: ImmParams = {
    sigmaCv: num(values, "sigma-cv"),
    sigmaCt: num(values, "sigma-ct"),
    sigmaOmega: num(values, "sigma-omega"),
    switchPerS: num(values, "switch"),
    ...(values["p0-scale"] === undefined ? {} : { p0Scale: num(values, "p0-scale", true) }),
    ...(values["r-scale"] === undefined ? {} : { rScale: num(values, "r-scale", true) }),
    ...(values["guarded-init"] === undefined
      ? {}
      : { guardedInit: guardedLevel(values["guarded-init"]) }),
    ...(values["report-sd"] === true ? { reportSd: true } : {}),
  };
  const f: FusionParams = {
    k: values.k === undefined ? FUSION_DEFAULT.k : num(values, "k", true),
    every: values.every === undefined ? FUSION_DEFAULT.every : num(values, "every", true),
  };
  if (!Number.isInteger(f.every)) throw new UsageError("--every must be a whole number of samples");
  const n = openPredictionSet(network, truth);
  const name = fusedName(n.estimator, p, f);
  const w = openPredictionWriter(out, name, "per_timestep", truth, {
    inputs: [{ estimator: n.estimator, sha256: fileDigest(network) }],
  });
  let rows = 0;
  let nonConverged = 0;
  const t0 = performance.now();
  try {
    for (const s of scenarioSource(truth)) {
      const pn = n.byIndex.get(s.metadata.index);
      if (pn === undefined)
        throw new Error(`scenario ${String(s.metadata.index)}: missing from ${network}`);
      const pr = fusedPredict(s, p, pn, f);
      rows += pr.rows.length;
      nonConverged += pr.rows.filter((r) => !r.converged).length;
      w.write(pr);
    }
    w.commit();
  } catch (e) {
    w.abort();
    throw e;
  }
  return {
    out,
    estimator: name,
    scenarios: w.count,
    rows,
    non_converged_rows: nonConverged,
    seconds: (performance.now() - t0) / 1000,
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
