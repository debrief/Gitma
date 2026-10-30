// End-to-end G0 run (quickstart §3) in one process: naive fitted twice, classical final mode,
// evaluation, gate, experiment folder. From generator 0.4.0 the classical checks and the
// evaluation use each test scenario up to the target's turn (`beforeManoeuvre`); the geometry
// and tracker checks use the whole scenario.
import { join } from "node:path";
import { existsSync, renameSync, writeFileSync } from "node:fs";
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
import type { GateVerdict, NaiveModel, Prediction, Scenario } from "@tma/types";
import { evaluate } from "./evaluate.js";
import { makeManifest, writeEvaluation, writeManifest, writeVerdict } from "./experiment.js";
import { checkNaiveReproducible, checkNoiseFreeRecovery, g0Verdict } from "./gate.js";
import {
  beforeManoeuvre,
  checkBearingResiduals,
  checkTrackerNoiseFree,
  checkTrackerNis,
  checkTrackerNoisy,
  G0_IMM,
  G0_IMM_STRAIGHT,
  checkIndependentGeometry,
  checkPerTimestepRecovery,
} from "./g0-checks.js";

/** Test scenarios also solved per timestep (≈ 10^5 rows; the whole split would take ~15 min). */
export const G0_PER_TIMESTEP_SCENARIOS = 1000;

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

/** Held-out scenarios checked for geometry and kinematics (G0 panel phase 4, geometry). */
export const G0_HELDOUT_SCENARIOS = 2000;

/** The first `G0_HELDOUT_SCENARIOS` of the held-out split, when the data has one. */
function heldoutSample(dataDir: string): Scenario[] {
  const path = join(dataDir, "heldout.f32pack");
  if (!existsSync(path)) return [];
  const out: Scenario[] = [];
  for (const s of readDataset(path).scenarios()) {
    if (out.length >= G0_HELDOUT_SCENARIOS) break;
    out.push(s);
  }
  return out;
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
  const full = [...truth.scenarios()];
  // Batch least squares assumes constant velocity: from generator 0.4.0 its checks run on each
  // scenario up to the target's turn (unchanged when the target holds course).
  const scenarios = full.map(beforeManoeuvre);
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

  const sub = scenarios.slice(0, G0_PER_TIMESTEP_SCENARIOS);
  const perTimestep = sub.map((s) => classicalPredict(s, "per_timestep"));
  const verdict = g0Verdict([
    checkNoiseFreeRecovery(truth.header, scenarios, byIndex(classical)),
    checkPerTimestepRecovery(sub, byIndex(perTimestep)),
    checkBearingResiduals(scenarios),
    checkIndependentGeometry([...full, ...heldoutSample(dataDir)], truth.header.parameter_ranges),
    checkTrackerNoiseFree(full.slice(0, G0_PER_TIMESTEP_SCENARIOS), truth.header.parameter_ranges),
    checkTrackerNoisy(truth.header.parameter_ranges),
    checkTrackerNis(truth.header.parameter_ranges),
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
        {
          name: `${CLASSICAL}:per_timestep`,
          settings: {
            method: "levenberg-marquardt",
            max_iterations: 50,
            grid_every: 6,
            mode: "per_timestep",
            scenarios: sub.length,
            note: "first scenarios of the test split, for check classical-per-timestep-recovers",
          },
        },
        {
          name: "imm",
          settings: {
            ...G0_IMM,
            scenarios: Math.min(full.length, G0_PER_TIMESTEP_SCENARIOS),
            note: "first scenarios of the test split, for check tracker-noise-free",
          },
        },
        {
          name: "imm:noisy-sanity",
          settings: {
            ...G0_IMM_STRAIGHT,
            note: "σ = 1° scenarios regenerated from the test split's ranges, for check tracker-noisy-sanity",
          },
        },
      ],
      [truth.header.created_by, commandLine],
    ),
  );
  return { verdict, experiment };
}
