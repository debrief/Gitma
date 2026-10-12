// Training loop (plan Phase 3): seeded batches via trainOnBatch, per-epoch validation, best-epoch
// weights, early stopping, wall-clock cap, NaN divergence, per-epoch checkpoint with resume.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as tf from "@tensorflow/tfjs-node";
import { canonicalJson } from "@tma/data";
import { type FeatureFile, NI, openFeatures } from "@tma/features";
import { GENERATOR_VERSION } from "@tma/sim";
import {
  type EpochRecord,
  ModelManifest,
  parseRecord,
  SCHEMA_VERSION,
  type StopReason,
  type TrainingConfig,
} from "@tma/types";
import { buildModel } from "./architectures.js";
import {
  batchRows,
  checkBucketing,
  epochBatches,
  labelMap,
  makeBatch,
  windowLengths,
} from "./batches.js";
import { lossParts, makeLoss, NY, termWeights } from "./loss.js";
import { environment, sha256File } from "./manifest.js";
import { threadSettings } from "./threads.js";

export interface TrainOptions {
  config: TrainingConfig;
  trainPath: string;
  valPath: string;
  outDir: string;
  log?: (line: string) => void;
}

const url = (dir: string): string => `file://${resolve(dir)}`;

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * One gradient step. tfjs's compile/trainOnBatch checks y against the output shape, which rejects
 * the packed per-row weight channel, so the step is written directly with the optimizer.
 */
export function trainStep(
  model: tf.LayersModel,
  optimizer: tf.Optimizer,
  loss: (y: tf.Tensor, p: tf.Tensor) => tf.Scalar,
  x: tf.Tensor,
  y: tf.Tensor,
): number {
  const cost = optimizer.minimize(
    () => loss(y, model.apply(x, { training: true }) as tf.Tensor),
    true,
  );
  const v = cost?.dataSync()[0] ?? NaN;
  cost?.dispose();
  return v;
}

async function validationLoss(
  model: tf.LayersModel,
  file: FeatureFile,
  config: TrainingConfig,
): Promise<number> {
  const w = termWeights(config);
  const ids = labelIdentity(file.count);
  let num = 0;
  let den = 0;
  for (let start = 0; start < file.count; start += config.batch_size) {
    const ks = Array.from(
      { length: Math.min(config.batch_size, file.count - start) },
      (_, i) => start + i,
    );
    const b = makeBatch(file, ks, { ...config, shuffle_labels: false }, ids);
    const [n, d] = tf.tidy(() => {
      const x = tf.tensor3d(b.x, [b.size, b.rows, NI]);
      const y = tf.tensor3d(b.y, [b.size, b.rows, NY]);
      const p = lossParts(w, y, model.predict(x) as tf.Tensor);
      return [p.num, p.den];
    });
    num += (await n.data())[0] ?? NaN;
    den += (await d.data())[0] ?? 0;
    n.dispose();
    d.dispose();
  }
  w.dispose();
  return den > 0 ? num / den : NaN;
}

function labelIdentity(n: number): Uint32Array {
  const id = new Uint32Array(n);
  for (let i = 0; i < n; i++) id[i] = i;
  return id;
}

export async function train(opts: TrainOptions): Promise<ModelManifest> {
  const { config, outDir } = opts;
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  mkdirSync(outDir, { recursive: true });
  const trainFile = openFeatures(opts.trainPath);
  const valFile = openFeatures(opts.valPath);
  try {
    const n = Math.min(trainFile.count, config.train_limit ?? trainFile.count);
    const labels = labelMap(config, n);
    checkBucketing(config);
    // Length bucketing (R15) needs each window's length; validation always uses full windows.
    const lengths = config.length_bucketing === true ? windowLengths(trainFile, n) : undefined;
    const manifestPath = join(outDir, "manifest.json");
    const ckptDir = join(outDir, "checkpoint");
    const bestDir = join(outDir, "best");

    let model: tf.LayersModel;
    let epochs: EpochRecord[] = [];
    let bestEpoch = -1;
    let best = Infinity;
    let priorSeconds = 0;

    // Resume when an unfinished run of the same config exists (Adam state restarts; recorded in log).
    const prior = existsSync(manifestPath)
      ? parseRecord(
          ModelManifest,
          JSON.parse(readFileSync(manifestPath, "utf8")),
          manifestPath,
          "manifest",
        )
      : null;
    if (
      prior !== null &&
      !prior.complete &&
      canonicalJson(prior.config) === canonicalJson(config) &&
      existsSync(join(ckptDir, "model.json"))
    ) {
      model = await tf.loadLayersModel(`${url(ckptDir)}/model.json`);
      epochs = prior.epochs;
      bestEpoch = prior.best_epoch;
      best = epochs.find((e) => e.epoch === bestEpoch)?.val_loss ?? Infinity;
      priorSeconds = epochs.at(-1)?.seconds ?? 0;
      log(
        `resuming ${config.id} after epoch ${String(epochs.length - 1)} (optimizer state restarts)`,
      );
    } else {
      if (prior?.complete === true) throw new Error(`${outDir} already holds a completed model`);
      model = buildModel(config);
    }
    const optimizer = tf.train.adam(config.learning_rate);
    const lossFn = makeLoss(config);

    const env = { ...environment(), ...threadSettings() };
    const digests = {
      train_features_digest: sha256File(opts.trainPath),
      val_features_digest: sha256File(opts.valPath),
    };
    const t0 = performance.now();
    const elapsed = (): number => priorSeconds + (performance.now() - t0) / 1000;
    const paramCount = model.countParams();

    const manifest = (
      stop: StopReason | undefined,
      complete: boolean,
      weightsPath: string | null,
    ): ModelManifest => ({
      id: config.id,
      config,
      schema_version: SCHEMA_VERSION,
      generator_version: GENERATOR_VERSION,
      ...digests,
      normalisation: trainFile.norm,
      epochs,
      best_epoch: bestEpoch,
      ...(stop === undefined ? {} : { stop_reason: stop }),
      complete,
      wall_s: elapsed(),
      parameter_count: paramCount,
      ...env,
      weights_digest:
        weightsPath !== null && existsSync(weightsPath) ? sha256File(weightsPath) : "",
    });

    let stop: StopReason = "max_epochs";
    for (let e = epochs.length; e < config.max_epochs; e++) {
      let lossSum = 0;
      let batches = 0;
      for (const ks of epochBatches(config, e, n, lengths)) {
        const b = makeBatch(trainFile, ks, config, labels, batchRows(config, ks, lengths));
        const x = tf.tensor3d(b.x, [b.size, b.rows, NI]);
        const y = tf.tensor3d(b.y, [b.size, b.rows, NY]);
        lossSum += trainStep(model, optimizer, lossFn, x, y);
        x.dispose();
        y.dispose();
        batches++;
      }
      const trainLoss = lossSum / batches;
      const valLoss = await validationLoss(model, valFile, config);
      epochs.push({ epoch: e, train_loss: trainLoss, val_loss: valLoss, seconds: elapsed() });
      log(
        `${config.id} epoch ${String(e)} train ${trainLoss.toFixed(5)} val ${valLoss.toFixed(5)} t=${elapsed().toFixed(0)}s`,
      );
      if (!Number.isFinite(trainLoss) || !Number.isFinite(valLoss)) {
        stop = "diverged";
        break;
      }
      if (valLoss < best) {
        best = valLoss;
        bestEpoch = e;
        await model.save(url(bestDir));
      }
      await model.save(url(ckptDir));
      writeJson(manifestPath, manifest(undefined, false, join(bestDir, "weights.bin")));
      if (e - bestEpoch >= config.patience) {
        stop = "early_stopping";
        break;
      }
      if (elapsed() >= config.max_wall_s) {
        stop = "wall_clock";
        break;
      }
    }

    if (stop === "diverged" || bestEpoch < 0) {
      const m = manifest("diverged", true, null);
      writeJson(manifestPath, m);
      return m;
    }
    const bestModel = await tf.loadLayersModel(`${url(bestDir)}/model.json`);
    await bestModel.save(url(outDir));
    rmSync(ckptDir, { recursive: true, force: true });
    rmSync(bestDir, { recursive: true, force: true });
    const m = manifest(stop, true, join(outDir, "weights.bin"));
    writeJson(manifestPath, m);
    return m;
  } finally {
    trainFile.close();
    valFile.close();
  }
}
