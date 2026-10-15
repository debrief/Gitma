// Training loop (plan Phase 3): seeded batches via trainOnBatch, per-epoch validation, best-epoch
// weights, early stopping, wall-clock cap, NaN divergence, per-epoch checkpoint with resume.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as tf from "@tensorflow/tfjs-node";
import { canonicalJson } from "@tma/data";
import { gitCommit, gitDirty } from "@tma/eval";
import { type FeatureFile, openFeatures } from "@tma/features";
import { GENERATOR_VERSION } from "@tma/sim";
import {
  type EpochRecord,
  ModelManifest,
  parseRecord,
  SCHEMA_VERSION,
  type StopReason,
  type TrainingConfig,
} from "@tma/types";
import { buildModel, modelInputWidth } from "./architectures.js";
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
  /**
   * Source provenance recorded in the manifest. Defaults to the commit and tree state read when
   * this process started (before training wrote anything); tests may pass their own.
   */
  source?: { commit: string; dirty: boolean };
  /** Id of the G0 experiment the training guard accepted (tma-train), recorded in the manifest. */
  g0Experiment?: string;
}

const url = (dir: string): string => `file://${resolve(dir)}`;

/**
 * Save to `<dir>.tmp`, then swap it in, so a copy taken at any moment (CI checkpoint sync) sees a
 * complete model in `dir` or, during the swap only, in `<dir>.old`. `extra` writes further files
 * (the optimizer state) into the same folder before the swap.
 */
async function saveAtomic(
  model: tf.LayersModel,
  dir: string,
  extra?: (tmp: string) => Promise<void>,
): Promise<void> {
  const tmp = `${dir}.tmp`;
  const old = `${dir}.old`;
  rmSync(tmp, { recursive: true, force: true });
  await model.save(url(tmp));
  if (extra !== undefined) await extra(tmp);
  rmSync(old, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(tmp, dir);
  rmSync(old, { recursive: true, force: true });
}

/** Checkpoint sidecar: Adam's state, and the last epoch of any patience grace (SRD §5, 2026-10-12). */
interface OptimizerState {
  grace_until: number;
  weights: { name: string; shape: number[]; dtype: "float32" | "int32" }[];
}

const OPT_JSON = "optimizer.json";
const OPT_BIN = "optimizer.bin";

async function saveOptimizer(opt: tf.Optimizer, dir: string, graceUntil: number): Promise<void> {
  const named = await opt.getWeights();
  const parts: Uint8Array[] = [];
  const state: OptimizerState = { grace_until: graceUntil, weights: [] };
  for (const { name, tensor } of named) {
    const dtype = tensor.dtype === "int32" ? "int32" : "float32";
    const data =
      dtype === "int32" ? Int32Array.from(tensor.dataSync()) : Float32Array.from(tensor.dataSync());
    parts.push(new Uint8Array(data.buffer));
    state.weights.push({ name, shape: tensor.shape, dtype });
  }
  writeFileSync(join(dir, OPT_BIN), Buffer.concat(parts));
  writeFileSync(join(dir, OPT_JSON), `${JSON.stringify(state)}\n`);
}

/** Restores Adam's state saved with a checkpoint; null if the checkpoint has none. */
async function loadOptimizer(opt: tf.Optimizer, dir: string): Promise<number | null> {
  if (!existsSync(join(dir, OPT_JSON))) return null;
  const state = JSON.parse(readFileSync(join(dir, OPT_JSON), "utf8")) as OptimizerState;
  const bin = readFileSync(join(dir, OPT_BIN));
  let at = 0;
  const named = state.weights.map(({ name, shape, dtype }) => {
    const size = shape.reduce((a, b) => a * b, 1);
    const bytes = bin.subarray(at, at + 4 * size);
    at += 4 * size;
    const copy = new Uint8Array(bytes).buffer;
    const values = dtype === "int32" ? new Int32Array(copy) : new Float32Array(copy);
    return { name, tensor: tf.tensor(values, shape, dtype) };
  });
  if (at !== bin.length) throw new Error(`${dir}/${OPT_BIN}: size does not match ${OPT_JSON}`);
  await opt.setWeights(named);
  return state.grace_until;
}

/** `dir` if it holds a saved model, else `<dir>.old` (a swap was interrupted), else null. */
function savedModelDir(dir: string): string | null {
  for (const d of [dir, `${dir}.old`]) if (existsSync(join(d, "model.json"))) return d;
  return null;
}

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
      const x = tf.tensor3d(b.x, [b.size, b.rows, file.inputChannels]);
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
  // Read before anything is written (the module-level helpers hold the process-start state).
  const source = opts.source ?? { commit: gitCommit(), dirty: gitDirty() };
  mkdirSync(outDir, { recursive: true });
  const trainFile = openFeatures(opts.trainPath);
  const valFile = openFeatures(opts.valPath);
  try {
    const n = Math.min(trainFile.count, config.train_limit ?? trainFile.count);
    const labels = labelMap(config, n);
    checkBucketing(config);
    // tma-train's lineage check names this refusal first; train() keeps it for direct callers.
    const featureSet = config.feature_set ?? "raw";
    for (const f of [trainFile, valFile]) {
      if (f.featureSet !== featureSet) {
        throw new Error(
          `feature-set-mismatch: config ${config.id} expects feature set ${featureSet}; ${f.path} holds ${f.featureSet}`,
        );
      }
    }
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
    let dirty = source.dirty;
    const optimizer = tf.train.adam(config.learning_rate);
    // Last epoch whose non-improvement is not counted towards patience (after an optimizer restart).
    let graceUntil = -1;
    // Set when this job re-scored the best weights: the manifest is rewritten before the first
    // epoch so a job that ends early still hands the re-scored value on (G2 2b panel, numerics).
    let rescored = false;

    // Resume when an unfinished run of the same config exists (Adam state restored from the checkpoint).
    const prior = existsSync(manifestPath)
      ? parseRecord(
          ModelManifest,
          JSON.parse(readFileSync(manifestPath, "utf8")),
          manifestPath,
          "manifest",
        )
      : null;
    const ckptSaved = savedModelDir(ckptDir);
    if (
      prior !== null &&
      !prior.complete &&
      canonicalJson(prior.config) === canonicalJson(config) &&
      ckptSaved !== null
    ) {
      // Earlier epochs must have trained on these very files (lineage is checked on the current
      // ones only; G0 panel red team, 2026-10-13).
      const now = { train: sha256File(opts.trainPath), val: sha256File(opts.valPath) };
      if (prior.train_features_digest !== now.train || prior.val_features_digest !== now.val) {
        throw new Error(
          `refusing to resume ${config.id}: earlier epochs trained on train ${prior.train_features_digest} / validation ${prior.val_features_digest}, these files are ${now.train} / ${now.val}`,
        );
      }
      model = await tf.loadLayersModel(`${url(ckptSaved)}/model.json`);
      if (modelInputWidth(model) !== trainFile.inputChannels) {
        throw new Error(
          `${ckptSaved}: checkpoint takes ${String(modelInputWidth(model))} input channels; ${opts.trainPath} has ${String(trainFile.inputChannels)}`,
        );
      }
      // An interrupted swap of best/ leaves only best.old: restore it as best/.
      const bestSaved = savedModelDir(bestDir);
      if (bestSaved !== null && bestSaved !== bestDir) renameSync(bestSaved, bestDir);
      epochs = prior.epochs;
      bestEpoch = prior.best_epoch;
      // The value later epochs must beat: persisted (schema 0.8.2) so that a chained job compares
      // against the same number as the job before it, including a re-scored one (below).
      best = prior.best_val_loss ?? epochs.find((e) => e.epoch === bestEpoch)?.val_loss ?? Infinity;
      priorSeconds = epochs.at(-1)?.seconds ?? 0;
      const restored = await loadOptimizer(optimizer, ckptSaved);
      if (restored !== null) {
        graceUntil = restored;
        log(
          `resuming ${config.id} after epoch ${String(epochs.length - 1)} (optimizer state restored)`,
        );
      } else {
        // Adam restarts: its first epochs may lose ground, so they do not count towards patience.
        graceUntil = epochs.length + 2;
        log(
          `resuming ${config.id} after epoch ${String(epochs.length - 1)} (optimizer state restarts; patience not counted for epochs ${String(epochs.length)}–${String(graceUntil)})`,
        );
        // A seeded continuation may change the loss (spec 004 decision 15): the recorded best
        // val_loss was computed under the old one, so later epochs would never "improve" on it and
        // the old weights would be kept. Re-score the best weights under this config's loss.
        const bestModel = await tf.loadLayersModel(`${url(bestDir)}/model.json`);
        const rebased = await validationLoss(bestModel, valFile, config);
        bestModel.dispose();
        if (rebased !== best) {
          log(
            `${config.id}: best epoch ${String(bestEpoch)} re-scored under this config's loss: val ${rebased.toFixed(5)} (recorded ${best.toFixed(5)})`,
          );
        }
        best = rebased;
        rescored = true;
      }
      // A dirty earlier job taints the whole run; the commit recorded is this (final) job's.
      dirty ||= prior.git_dirty === true;
      if (typeof prior.git_commit === "string" && prior.git_commit !== source.commit) {
        log(
          `earlier epochs were trained at commit ${prior.git_commit}; this job runs ${source.commit}`,
        );
      }
    } else {
      if (prior?.complete === true) throw new Error(`${outDir} already holds a completed model`);
      model = buildModel(config, trainFile.inputChannels);
    }
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
      ...(Number.isFinite(best) ? { best_val_loss: best } : {}),
      ...(prior?.continued_from == null ? {} : { continued_from: prior.continued_from }),
      ...(stop === undefined ? {} : { stop_reason: stop }),
      complete,
      wall_s: elapsed(),
      parameter_count: paramCount,
      ...env,
      git_commit: source.commit,
      git_dirty: dirty,
      ...(trainFile.source === undefined ? {} : { source_dataset_header: trainFile.source.header }),
      ...(opts.g0Experiment === undefined ? {} : { g0_experiment: opts.g0Experiment }),
      weights_digest:
        weightsPath !== null && existsSync(weightsPath) ? sha256File(weightsPath) : "",
    });

    if (rescored) writeJson(manifestPath, manifest(undefined, false, join(bestDir, "weights.bin")));

    let stop: StopReason = "max_epochs";
    for (let e = epochs.length; e < config.max_epochs; e++) {
      let lossSum = 0;
      let batches = 0;
      for (const ks of epochBatches(config, e, n, lengths)) {
        const b = makeBatch(trainFile, ks, config, labels, batchRows(config, ks, lengths));
        const x = tf.tensor3d(b.x, [b.size, b.rows, trainFile.inputChannels]);
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
        await saveAtomic(model, bestDir);
      }
      await saveAtomic(model, ckptDir, (tmp) => saveOptimizer(optimizer, tmp, graceUntil));
      writeJson(manifestPath, manifest(undefined, false, join(bestDir, "weights.bin")));
      if (e - Math.max(bestEpoch, graceUntil) >= config.patience) {
        stop = "early_stopping";
        break;
      }
      // Stop when another epoch of the length just run would cross the cap, so a run never
      // exceeds max_wall_s (CI jobs have a hard limit; research R1).
      const prev = epochs.at(-2)?.seconds ?? priorSeconds;
      const lastEpochS = elapsed() - prev;
      if (elapsed() + lastEpochS > config.max_wall_s) {
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
    // Mark complete before removing the checkpoints, so a copy taken in between never shows an
    // unfinished run with nothing to resume from.
    const m = manifest(stop, true, join(outDir, "weights.bin"));
    writeJson(manifestPath, m);
    for (const d of [ckptDir, bestDir]) {
      for (const x of [d, `${d}.tmp`, `${d}.old`]) rmSync(x, { recursive: true, force: true });
    }
    return m;
  } finally {
    trainFile.close();
    valFile.close();
  }
}
