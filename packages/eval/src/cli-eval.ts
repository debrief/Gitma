import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { parseSeed } from "@tma/sim";
import { BOOTSTRAP_SEED, bootstrapEvaluation } from "./bootstrap.js";
import { compareOnCommonRows } from "./compare.js";
import { evaluate } from "./evaluate.js";
import {
  makeManifest,
  writeBootstrap,
  writeComparison,
  writeEvaluation,
  writeManifest,
} from "./experiment.js";
import { perTimestep } from "./gate-g1.js";
import { requireBaselines } from "./load.js";
import { openPredictionSet } from "./prediction-file.js";

const USAGE =
  "usage: tma-eval --truth <split> --pred <file> [--pred <file>...] --experiment <dir> [--points 300] [--curve-step 60] [--bootstrap <B>] [--bootstrap-seed <u64>] [--compare-to <estimator label>]";

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      pred: { type: "string", multiple: true },
      experiment: { type: "string" },
      points: { type: "string", default: "300" },
      "curve-step": { type: "string", default: "60" },
      bootstrap: { type: "string" },
      "bootstrap-seed": { type: "string" },
      "compare-to": { type: "string" },
    },
  });
  const preds = values.pred ?? [];
  if (values.truth === undefined || values.experiment === undefined || preds.length === 0) {
    throw new UsageError(USAGE);
  }
  const truthPath = values.truth;
  const points = values.points.split(",").map(Number);
  const curveStep = Number(values["curve-step"]);
  if (points.some((p) => !Number.isFinite(p)) || !(curveStep > 0))
    throw new UsageError("bad --points/--curve-step");
  const resamples = values.bootstrap === undefined ? undefined : Number(values.bootstrap);
  if (resamples !== undefined && !(Number.isInteger(resamples) && resamples > 0))
    throw new UsageError("bad --bootstrap: expected a positive number of resamples");
  if (values["bootstrap-seed"] !== undefined && resamples === undefined)
    throw new UsageError("--bootstrap-seed needs --bootstrap");
  let seed = BOOTSTRAP_SEED;
  if (values["bootstrap-seed"] !== undefined) {
    try {
      seed = parseSeed(values["bootstrap-seed"]);
    } catch (e) {
      throw new UsageError(`bad --bootstrap-seed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const sets = preds.map((p) => openPredictionSet(p, truthPath));
  requireBaselines(sets);
  const compareTo = values["compare-to"];
  if (compareTo !== undefined && !sets.some((s) => s.label === compareTo)) {
    throw new Error(`--compare-to ${compareTo}: no prediction file has that label`);
  }
  const ds = readDataset(truthPath);
  const ev = evaluate(ds.scenarios(), sets, { points, curveStep });
  writeEvaluation(values.experiment, ev);
  let intervals = 0;
  if (resamples !== undefined) {
    const report = bootstrapEvaluation(ds.scenarios(), sets, {
      points,
      resamples,
      seed,
      reference: perTimestep("naive"),
    });
    writeBootstrap(values.experiment, report);
    intervals = report.medians.length + report.ratios.length;
  }
  let comparisons = 0;
  if (compareTo !== undefined) {
    const rows = compareOnCommonRows(ds.scenarios(), sets, compareTo, points);
    writeComparison(values.experiment, rows);
    comparisons = rows.length;
  }
  const id = values.experiment.split("/").filter(Boolean).at(-1) ?? "experiment";
  writeManifest(
    values.experiment,
    makeManifest(
      id,
      [{ path: truthPath, header: ds.header }],
      sets.map((s) => ({ name: s.label, settings: {} })),
      [["tma-eval", ...argv].join(" ")],
    ),
  );
  return {
    experiment: values.experiment,
    metrics: ev.metrics.length,
    curves: ev.curves.length,
    ...(resamples === undefined ? {} : { intervals }),
    ...(compareTo === undefined ? {} : { comparisons }),
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
