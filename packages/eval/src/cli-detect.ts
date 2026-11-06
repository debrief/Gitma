// tma-detect (spec 017): per-timestep manoeuvre-detection scores, written as a detection file
// (schema 0.19.0). A pipeline stage of its own; thresholds are applied by tma-g6, not here.
// - `--detector cusum`: CUSUM on the IMM's innovations (`cusumDetect`), IMM settings as
//   tma-track's, drift `--c`.
// - `--detector disagree`: course disagreement of `--network` and `--tracker` prediction files.
// - `--detector crate`: `--network`'s own course change over `--window` samples.
// The inputs' SHA-256s are recorded in the header.
import { parseArgs } from "node:util";
import {
  courseRateDetect,
  cusumDetect,
  cusumName,
  courseRateName,
  disagreementDetect,
  disagreementName,
  fileDigest,
  type GuardedInit,
  type ImmParams,
} from "@tma/classical";
import { isMain, runCli, UsageError } from "@tma/data";
import type { Detection, Scenario } from "@tma/types";
import { openDetectionWriter } from "./detection-file.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-detect --truth <split.f32pack> --out <scores.ndjson> " +
  "(--detector cusum --sigma-cv <a> --sigma-ct <a> --sigma-omega <w> --switch <p> [--p0-scale k] [--r-scale k] [--guarded-init 1|2] --kind nis|mean --c <drift> --clip <bound> " +
  "| --detector disagree --network <t2.ndjson> --tracker <imm.ndjson> " +
  "| --detector crate --network <t2.ndjson> --window <samples>)";

function num(values: Record<string, string | undefined>, key: string, positive = false): number {
  const raw = values[key];
  const v = Number(raw);
  if (raw === undefined || !Number.isFinite(v) || v < 0 || (positive && v === 0))
    throw new UsageError(`--${key} must be a number ${positive ? "> 0" : "≥ 0"}`);
  return v;
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      out: { type: "string" },
      detector: { type: "string" },
      "sigma-cv": { type: "string" },
      "sigma-ct": { type: "string" },
      "sigma-omega": { type: "string" },
      switch: { type: "string" },
      "p0-scale": { type: "string" },
      "r-scale": { type: "string" },
      "guarded-init": { type: "string" },
      c: { type: "string" },
      kind: { type: "string" },
      clip: { type: "string" },
      network: { type: "string" },
      tracker: { type: "string" },
      window: { type: "string" },
    },
  });
  const { truth, out, detector } = values;
  if (!truth || !out) throw new UsageError(USAGE);
  let name: string;
  let make: (s: Scenario) => Detection;
  let inputs: { estimator: string; sha256: string }[] = [];
  if (detector === "cusum") {
    const g = values["guarded-init"];
    if (g !== undefined && g !== "1" && g !== "2")
      throw new UsageError("--guarded-init must be 1 or 2");
    const p: ImmParams = {
      sigmaCv: num(values, "sigma-cv"),
      sigmaCt: num(values, "sigma-ct"),
      sigmaOmega: num(values, "sigma-omega"),
      switchPerS: num(values, "switch"),
      ...(values["p0-scale"] === undefined ? {} : { p0Scale: num(values, "p0-scale", true) }),
      ...(values["r-scale"] === undefined ? {} : { rScale: num(values, "r-scale", true) }),
      ...(g === undefined ? {} : { guardedInit: Number(g) as GuardedInit }),
    };
    const kind = values.kind;
    if (kind !== "nis" && kind !== "mean") throw new UsageError("--kind must be nis or mean");
    const q = { kind, c: num(values, "c", true), clip: num(values, "clip", true) } as const;
    name = cusumName(p, q);
    make = (s) => cusumDetect(s, p, q);
  } else if (detector === "disagree" || detector === "crate") {
    if (!values.network) throw new UsageError(`--detector ${detector} needs --network\n${USAGE}`);
    const n = openPredictionSet(values.network, truth);
    inputs = [{ estimator: n.estimator, sha256: fileDigest(values.network) }];
    const net = (s: Scenario) => {
      const p = n.byIndex.get(s.metadata.index);
      if (p === undefined)
        throw new Error(
          `scenario ${String(s.metadata.index)}: missing from ${String(values.network)}`,
        );
      return p;
    };
    if (detector === "disagree") {
      if (!values.tracker) throw new UsageError(`--detector disagree needs --tracker\n${USAGE}`);
      const t = openPredictionSet(values.tracker, truth);
      inputs.push({ estimator: t.estimator, sha256: fileDigest(values.tracker) });
      name = disagreementName(n.estimator, t.estimator);
      make = (s) => {
        const pt = t.byIndex.get(s.metadata.index);
        if (pt === undefined)
          throw new Error(
            `scenario ${String(s.metadata.index)}: missing from ${String(values.tracker)}`,
          );
        return disagreementDetect(net(s), pt);
      };
    } else {
      const w = num(values, "window", true);
      if (!Number.isInteger(w)) throw new UsageError("--window must be a whole number of samples");
      name = courseRateName(n.estimator, w);
      make = (s) => courseRateDetect(net(s), w);
    }
  } else throw new UsageError(`--detector must be cusum, disagree or crate\n${USAGE}`);
  const w = openDetectionWriter(out, name, truth, inputs);
  try {
    for (const s of scenarioSource(truth)) w.write(make(s));
    w.commit();
  } catch (e) {
    w.abort();
    throw e;
  }
  return { out, detector: name, scenarios: w.count };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
