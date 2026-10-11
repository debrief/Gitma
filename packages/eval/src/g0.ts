// End-to-end G0 run (quickstart §3) in one process: naive fitted twice, classical final mode,
// evaluation, gate, experiment folder.
import { join } from "node:path";
import { renameSync, writeFileSync } from "node:fs";
import {
  CLASSICAL,
  classicalPredict,
  fileDigest,
  fitNaive,
  NAIVE,
  naivePredict,
  predictionHeader,
  predictionLines,
} from "@tma/classical";
import { canonicalJson, readDataset } from "@tma/data";
import type { GateVerdict, NaiveModel, Prediction } from "@tma/types";
import { evaluate } from "./evaluate.js";
import { makeManifest, writeEvaluation, writeManifest, writeVerdict } from "./experiment.js";
import { checkNaiveReproducible, checkNoiseFreeRecovery, g0Verdict } from "./gate.js";

function writePredictions(
  path: string,
  estimator: string,
  truth: string,
  preds: Prediction[],
): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(
    tmp,
    `${predictionLines(predictionHeader(estimator, "final", truth), preds).join("\n")}\n`,
  );
  renameSync(tmp, path);
}

export interface G0Result {
  verdict: GateVerdict;
  experiment: string;
}

export function runG0(dataDir: string, experiment: string, commandLine: string): G0Result {
  const train = join(dataDir, "train.f32pack");
  const test = join(dataDir, "test.f32pack");
  const trainDigest = fileDigest(train);
  const fit = (): NaiveModel => fitNaive(readDataset(train).scenarios(), trainDigest);
  const naiveA = fit();
  const naiveB = fit();
  writeFileSync(join(dataDir, "naive.json"), `${canonicalJson(naiveA)}\n`);

  const truth = readDataset(test);
  const scenarios = [...truth.scenarios()];
  const classical = scenarios.map((s) => classicalPredict(s, "final"));
  const predA = scenarios.map((s) => naivePredict(s, naiveA, "final"));
  const predB = scenarios.map((s) => naivePredict(s, naiveB, "final"));
  writePredictions(join(dataDir, "classical.ndjson"), CLASSICAL, test, classical);
  writePredictions(join(dataDir, "naive.ndjson"), NAIVE, test, predA);

  const byIndex = (ps: Prediction[]) => new Map(ps.map((p) => [p.scenario_index, p]));
  const set = (label: string, ps: Prediction[]) => ({
    label,
    estimator: label,
    byIndex: byIndex(ps),
  });
  const evA = evaluate(scenarios, [set(NAIVE, predA), set(CLASSICAL, classical)]);
  const evB = evaluate(scenarios, [set(NAIVE, predB), set(CLASSICAL, classical)]);

  const verdict = g0Verdict([
    checkNoiseFreeRecovery(truth.header, scenarios, byIndex(classical)),
    checkNaiveReproducible(evA.metrics, evB.metrics),
  ]);
  writeEvaluation(experiment, evA);
  writeVerdict(experiment, verdict);
  const id = experiment.split("/").filter(Boolean).at(-1) ?? "experiment";
  writeManifest(
    experiment,
    makeManifest(
      id,
      [
        { path: train, header: readDataset(train).header },
        { path: test, header: truth.header },
      ],
      [
        { name: NAIVE, settings: { fitted_on: "train", means: naiveA.final } },
        {
          name: CLASSICAL,
          settings: { method: "levenberg-marquardt", max_iterations: 50, mode: "final" },
        },
      ],
      [commandLine],
    ),
  );
  return { verdict, experiment };
}
