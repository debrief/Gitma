import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { evaluate } from "./evaluate.js";
import { makeManifest, writeEvaluation, writeManifest } from "./experiment.js";
import { loadPredictionSet, requireBaselines } from "./load.js";

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
    },
  });
  const preds = values.pred ?? [];
  if (values.truth === undefined || values.experiment === undefined || preds.length === 0) {
    throw new UsageError(
      "usage: tma-eval --truth <split> --pred <file> [--pred <file>...] --experiment <dir> [--points 300] [--curve-step 60]",
    );
  }
  const truthPath = values.truth;
  const points = values.points.split(",").map(Number);
  const curveStep = Number(values["curve-step"]);
  if (points.some((p) => !Number.isFinite(p)) || !(curveStep > 0))
    throw new UsageError("bad --points/--curve-step");
  const sets = preds.map((p) => loadPredictionSet(p, truthPath));
  requireBaselines(sets);
  const ds = readDataset(truthPath);
  const ev = evaluate(ds.scenarios(), sets, { points, curveStep });
  writeEvaluation(values.experiment, ev);
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
  return { experiment: values.experiment, metrics: ev.metrics.length, curves: ev.curves.length };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
