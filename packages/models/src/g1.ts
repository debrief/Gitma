// One-command G1 run (quickstart §3): naive and classical per-timestep, every trained model's
// predictions, evaluation, the G1 gate, and an experiment folder with model manifests and weights.
// Lives here rather than in @tma/eval so tfjs-node stays out of the evaluation package.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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
import { readDataset } from "@tma/data";
import {
  evaluate,
  type G1Ids,
  bootstrapMedianRatio,
  G1_SECONDS,
  g1Checks,
  pairedRangeErrors,
  prettyJson,
  type RatioInterval,
  g1Verdict,
  loadPredictionSet,
  makeManifest,
  type PredictionSet,
  writeEvaluation,
  writeManifest,
  writeVerdict,
} from "@tma/eval";
import { openFeatures } from "@tma/features";
import type { GateVerdict, ModelManifest, Prediction, Scenario } from "@tma/types";
import { readModelManifest } from "./manifest-io.js";
import { loadModel, predictScenarios, requireSameNormalisation } from "./predict.js";

export interface G1Options {
  data: string;
  models: string;
  experiment: string;
  commandLine: string;
  log?: (line: string) => void;
}

interface TrainedModel {
  dir: string;
  manifest: ModelManifest;
}

/** Trained models under `dir`, each assigned its G1 role by kind (exactly one per role). */
export function findModels(dir: string): { ids: G1Ids; models: TrainedModel[] } {
  const models = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "manifest.json")))
    .map((e) => ({ dir: join(dir, e.name), manifest: readModelManifest(join(dir, e.name)) }))
    .sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));
  const role = (kind: string, shuffled: boolean): string[] =>
    models
      .filter((m) => m.manifest.config.model_kind === kind)
      .filter((m) => m.manifest.config.shuffle_labels === shuffled)
      .map((m) => m.manifest.id);
  const one = (kind: string, shuffled = false): string => {
    const ids = role(kind, shuffled);
    const [id] = ids;
    if (ids.length !== 1 || id === undefined) {
      throw new Error(
        `${dir}: need exactly one ${shuffled ? "shuffled " : ""}${kind} model, found ${String(ids.length)} (${ids.join(", ")})`,
      );
    }
    return id;
  };
  const ids: G1Ids = {
    instantaneous: one("instantaneous"),
    timeLate: one("time_late"),
    causalControl: one("causal_cnn"),
    mlpControl: one("mlp"),
    shuffled: one("instantaneous", true),
  };
  if (new Set(models.map((m) => m.manifest.id)).size !== models.length) {
    throw new Error(`${dir}: duplicate model ids`);
  }
  return { ids, models };
}

function writePredictions(path: string, estimator: string, truth: string, ps: Prediction[]): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(
    tmp,
    `${predictionLines(predictionHeader(estimator, "per_timestep", truth), ps).join("\n")}\n`,
  );
  renameSync(tmp, path);
}

const set = (estimator: string, ps: Prediction[]): PredictionSet => ({
  label: `${estimator}:per_timestep`,
  estimator,
  byIndex: new Map(ps.map((p) => [p.scenario_index, p])),
});

export async function runG1(opts: G1Options): Promise<GateVerdict> {
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const { ids, models } = findModels(opts.models);
  const trainPath = join(opts.data, "train.f32pack");
  const naive = fitNaive(readDataset(trainPath).scenarios(), fileDigest(trainPath));
  const predDir = join(opts.data, "predictions");
  mkdirSync(predDir, { recursive: true });

  interface Scored {
    evaluation: ReturnType<typeof evaluate>;
    scenarios: Scenario[];
    sets: PredictionSet[];
  }
  const score = async (split: "test" | "heldout"): Promise<Scored> => {
    const truthPath = join(opts.data, `${split}.f32pack`);
    const scenarios: Scenario[] = [...readDataset(truthPath).scenarios()];
    const sets: PredictionSet[] = [
      set(
        NAIVE,
        scenarios.map((s) => naivePredict(s, naive, "per_timestep")),
      ),
    ];

    // Classical per-timestep is the slow step; reuse a cached file made from the same truth.
    const classicalPath = join(predDir, `${split}.classical.ndjson`);
    if (existsSync(classicalPath)) {
      log(`${split}: reusing ${classicalPath}`);
      sets.push(loadPredictionSet(classicalPath, truthPath));
    } else {
      log(`${split}: classical per-timestep on ${String(scenarios.length)} scenarios`);
      const ps = scenarios.map((s) => classicalPredict(s, "per_timestep"));
      writePredictions(classicalPath, CLASSICAL, truthPath, ps);
      sets.push(set(CLASSICAL, ps));
    }

    const features = openFeatures(join(opts.data, `${split}.features.bin`));
    try {
      for (const m of models) {
        log(`${split}: predicting ${m.manifest.id}`);
        requireSameNormalisation(features, m.manifest.normalisation, m.manifest.id);
        const model = await loadModel(m.dir);
        const ps = predictScenarios(
          model,
          features,
          scenarios,
          m.manifest.normalisation,
          m.manifest.id,
        );
        model.dispose();
        writePredictions(
          join(predDir, `${split}.${m.manifest.id}.ndjson`),
          m.manifest.id,
          truthPath,
          ps,
        );
        sets.push(set(m.manifest.id, ps));
      }
    } finally {
      features.close();
    }
    return { evaluation: evaluate(scenarios, sets), scenarios, sets };
  };

  const scored = await score("test");
  const test = scored.evaluation;
  // T033: paired bootstrap interval of each G1 model's median range error over naive's.
  const bySet = (estimator: string): PredictionSet => {
    const found = scored.sets.find((x) => x.estimator === estimator);
    if (found === undefined) throw new Error(`no predictions for ${estimator}`);
    return found;
  };
  const interval = (id: string): RatioInterval => {
    const e = pairedRangeErrors(scored.scenarios, bySet(id), bySet(NAIVE), G1_SECONDS);
    return bootstrapMedianRatio(e.a, e.b);
  };
  const intervals = {
    instantaneous: interval(ids.instantaneous),
    timeLate: interval(ids.timeLate),
  };
  mkdirSync(opts.experiment, { recursive: true });
  writeFileSync(
    join(opts.experiment, "bootstrap.json"),
    prettyJson({
      point: "zig+300s",
      ratio: "median range error, model / naive",
      [ids.instantaneous]: intervals.instantaneous,
      [ids.timeLate]: intervals.timeLate,
    }),
  );
  const verdict = g1Verdict(g1Checks(test.metrics, test.curves, ids, intervals));
  writeEvaluation(opts.experiment, test);
  writeVerdict(opts.experiment, verdict);
  // FR-014: the held-out geometry split is scored and reported, not gated.
  writeEvaluation(join(opts.experiment, "heldout"), (await score("heldout")).evaluation);

  for (const m of models) {
    const dest = join(opts.experiment, "models", m.manifest.id);
    mkdirSync(dest, { recursive: true });
    for (const f of ["manifest.json", "model.json", "weights.bin"])
      copyFileSync(join(m.dir, f), join(dest, f));
  }
  const id = opts.experiment.split("/").filter(Boolean).at(-1) ?? "experiment";
  const datasets = (["train", "test", "heldout"] as const).map((s) => {
    const path = join(opts.data, `${s}.f32pack`);
    return { path, header: readDataset(path).header };
  });
  writeManifest(
    opts.experiment,
    makeManifest(
      id,
      datasets,
      [
        {
          name: NAIVE,
          settings: { fitted_on: "train", mode: "per_timestep", means: naive.per_timestep },
        },
        {
          name: CLASSICAL,
          settings: { method: "levenberg-marquardt", mode: "per_timestep", grid_every: 6 },
        },
        ...models.map((m) => ({
          name: m.manifest.id,
          settings: {
            manifest: `models/${m.manifest.id}/manifest.json`,
            weights_digest: m.manifest.weights_digest,
            config: m.manifest.config,
          },
        })),
      ],
      [opts.commandLine],
    ),
  );
  return verdict;
}
