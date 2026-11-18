// tma-fuse-track (spec 014): the fused tracker's per-timestep predictions (fusedPredict in
// @tma/classical): the IMM with a network's range fused in as a measurement. A pipeline stage of
// its own; the IMM's parameters, k and the update interval are part of the estimator name, so a
// gate binds them with the decision. The network's file digest is recorded in the header
// (`inputs`, schema 0.17.0), so tma-g5 can tie the fused file to bound weights. `--filter ekf
// --sigma-a <a>` fuses into the EKF instead (spec 028, SRD Annex F).
import { parseArgs } from "node:util";
import {
  FUSION_DEFAULT,
  type FusionParams,
  fileDigest,
  fusedEkfName,
  fusedEkfPredict,
  fusedName,
  fusedPredict,
  type ImmParams,
  type TrackerScales,
} from "@tma/classical";
import { isMain, runCli, UsageError } from "@tma/data";
import type { Prediction, Scenario } from "@tma/types";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-fuse-track --truth <split.f32pack> --network <t2.ndjson> --out <fused.ndjson> " +
  "--sigma-cv <m/s²> --sigma-ct <m/s²> --sigma-omega <rad/s/√s> --switch <1/s> " +
  "[--p0-scale k] [--r-scale k] [--guarded-init 1|2] [--report-sd] [--k 4] [--every 6]; " +
  "or --filter ekf --sigma-a <m/s²> [--p0-scale k] [--r-scale k] [--guarded-init 1|2] [--k] [--every] [--fade c] [--adapt-hi a --adapt-eta e]";

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
      filter: { type: "string" },
      "sigma-a": { type: "string" },
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
      fade: { type: "string" },
      "adapt-hi": { type: "string" },
      "adapt-eta": { type: "string" },
    },
  });
  const { truth, network, out } = values;
  if (!truth || !network || !out) throw new UsageError(USAGE);
  const filter = values.filter ?? "imm";
  if (filter !== "imm" && filter !== "ekf") throw new UsageError("--filter must be imm or ekf");
  const scales: TrackerScales = {
    ...(values["p0-scale"] === undefined ? {} : { p0Scale: num(values, "p0-scale", true) }),
    ...(values["r-scale"] === undefined ? {} : { rScale: num(values, "r-scale", true) }),
    ...(values["guarded-init"] === undefined
      ? {}
      : { guardedInit: guardedLevel(values["guarded-init"]) }),
  };
  const f: FusionParams = {
    k: values.k === undefined ? FUSION_DEFAULT.k : num(values, "k", true),
    every: values.every === undefined ? FUSION_DEFAULT.every : num(values, "every", true),
  };
  if (!Number.isInteger(f.every)) throw new UsageError("--every must be a whole number of samples");
  if (values.fade !== undefined) {
    if (filter !== "ekf") throw new UsageError("--fade needs --filter ekf (spec 029)");
    f.fade = num(values, "fade");
  }
  if (values["adapt-hi"] !== undefined || values["adapt-eta"] !== undefined) {
    if (filter !== "ekf")
      throw new UsageError("--adapt-hi/--adapt-eta need --filter ekf (spec 029)");
    f.adapt = { hi: num(values, "adapt-hi", true), eta: num(values, "adapt-eta", true) };
  }
  let tracker: { name: (net: string) => string; run: (s: Scenario, n: Prediction) => Prediction };
  if (filter === "ekf") {
    if (values["report-sd"] === true) throw new UsageError("--report-sd is for the IMM only");
    for (const k of ["sigma-cv", "sigma-ct", "sigma-omega", "switch"])
      if (values[k as keyof typeof values] !== undefined)
        throw new UsageError(`--${k} is an IMM setting; the EKF takes --sigma-a`);
    const sigmaA = num(values, "sigma-a");
    tracker = {
      name: (net) => fusedEkfName(net, sigmaA, scales, f),
      run: (s, pn) => fusedEkfPredict(s, sigmaA, scales, pn, f),
    };
  } else {
    if (values["sigma-a"] !== undefined) throw new UsageError("--sigma-a needs --filter ekf");
    const p: ImmParams = {
      sigmaCv: num(values, "sigma-cv"),
      sigmaCt: num(values, "sigma-ct"),
      sigmaOmega: num(values, "sigma-omega"),
      switchPerS: num(values, "switch"),
      ...scales,
      ...(values["report-sd"] === true ? { reportSd: true } : {}),
    };
    tracker = {
      name: (net) => fusedName(net, p, f),
      run: (s, pn) => fusedPredict(s, p, pn, f),
    };
  }
  const n = openPredictionSet(network, truth);
  const name = tracker.name(n.estimator);
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
      const pr = tracker.run(s, pn);
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
