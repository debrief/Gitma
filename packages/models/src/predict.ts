// Model outputs → Prediction rows (research R7), scored by the iteration-0 harness unchanged.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import * as tf from "@tensorflow/tfjs-node";
import { canonicalJson } from "@tma/data";
import {
  COURSE_SPEED,
  type FeatureFile,
  type OutputSpec,
  outputsToPrediction,
  ROWS,
} from "@tma/features";
import type {
  DatasetHeader,
  FeatureSet,
  NormalisationConstants,
  Prediction,
  Scenario,
} from "@tma/types";
import { modelInputWidth, NO } from "./architectures.js";

/** Moved to `@tma/features` (decode.ts) so the browser viewer shares it; re-exported here. */
export { outputsToPrediction };

export async function loadModel(dir: string): Promise<tf.LayersModel> {
  return tf.loadLayersModel(`file://${resolve(dir)}/model.json`);
}

const headerDigest = (h: DatasetHeader): string =>
  createHash("sha256").update(canonicalJson(h)).digest("hex");

/** A model's training data, for telling a schema-version relabel from different data. */
export interface TrainProvenance {
  /** Header of the train split the features were normalised from. */
  header: DatasetHeader;
  /** schema_version recorded in the model's manifest. */
  modelSchemaVersion: string;
  /** The model manifest's `source_dataset_header` (schema 0.8.0+), when recorded. */
  modelSourceHeader?: DatasetHeader | null | undefined;
}

/** Header fields that name where and when data were generated, not what the data are. */
const PROVENANCE_FIELDS = [
  "generator_git_commit",
  "generator_git_dirty",
  "schema_version",
] as const;

const withoutProvenance = (h: DatasetHeader): string =>
  canonicalJson(
    Object.fromEntries(
      Object.entries(h).filter(([k]) => !(PROVENANCE_FIELDS as readonly string[]).includes(k)),
    ),
  );

/**
 * Refuse features normalised differently from the model's training data. Tolerated, with
 * identical constants: train headers that differ only in `schema_version` (a schema bump after
 * training), or only in provenance (data regenerated, clean, at a later commit; needs the model's
 * `source_dataset_header`). Returns a note saying so; undefined if identical.
 */
export function requireSameNormalisation(
  file: FeatureFile,
  norm: NormalisationConstants,
  modelId: string,
  train?: TrainProvenance,
): string | undefined {
  if (canonicalJson(file.norm) === canonicalJson(norm)) return undefined;
  const { train_header_digest: fileDigest, ...fileConstants } = file.norm;
  const { train_header_digest: modelDigest, ...modelConstants } = norm;
  if (
    train !== undefined &&
    canonicalJson(fileConstants) === canonicalJson(modelConstants) &&
    headerDigest(train.header) === fileDigest &&
    headerDigest({ ...train.header, schema_version: train.modelSchemaVersion }) === modelDigest
  ) {
    return `${modelId}: train header differs only in schema_version (${train.modelSchemaVersion} → ${train.header.schema_version}); normalisation constants identical`;
  }
  // Data regenerated at a later commit (same seed, ranges and generator version; the plan's
  // content digests pin the scenarios): the headers differ only in provenance, so the train
  // header digest differs while the constants are identical. Both headers must be clean.
  const src = train?.modelSourceHeader;
  if (
    train !== undefined &&
    src !== undefined &&
    src !== null &&
    canonicalJson(fileConstants) === canonicalJson(modelConstants) &&
    headerDigest(train.header) === fileDigest &&
    headerDigest(src) === modelDigest &&
    train.header.generator_git_dirty === false &&
    src.generator_git_dirty === false &&
    withoutProvenance(train.header) === withoutProvenance(src)
  ) {
    return `${modelId}: train data regenerated at ${String(train.header.generator_git_commit)} (model trained on data from ${String(src.generator_git_commit)}); headers identical apart from provenance, normalisation constants identical`;
  }
  throw new Error(`${file.path}: normalisation differs from the one ${modelId} was trained with`);
}

/**
 * Refuse features of another feature set than the model was trained on (spec 003 US3 scenario 2):
 * a raw model never scores derived files, nor the reverse. `trained` is the manifest config's
 * `feature_set` (absent = raw).
 */
export function requireSameFeatureSet(
  file: FeatureFile,
  trained: FeatureSet | null | undefined,
  modelId: string,
): void {
  const want = trained ?? "raw";
  if (file.featureSet !== want) {
    throw new Error(
      `feature-set-mismatch: ${modelId} was trained on feature set ${want}; ${file.path} holds ${file.featureSet}`,
    );
  }
}

/**
 * Runs the model over every scenario of `truth` (looked up in `features` by index). Refuses a
 * features file whose input width differs from the model's. `spec` is the model's output
 * parameterisation (`outputSpec(manifest.config)`).
 */
export function predictScenarios(
  model: tf.LayersModel,
  features: FeatureFile,
  truth: Iterable<Scenario>,
  norm: NormalisationConstants,
  estimator: string,
  spec: OutputSpec = COURSE_SPEED,
  batchSize = 256,
): Prediction[] {
  const out: Prediction[] = [];
  predictEach(model, features, truth, norm, estimator, spec, batchSize, (p) => out.push(p));
  return out;
}

/**
 * `predictScenarios`, streamed: each prediction is passed to `emit` in truth order as its batch
 * completes, so a caller can write it out without holding the split's predictions.
 */
export function predictEach(
  model: tf.LayersModel,
  features: FeatureFile,
  truth: Iterable<Scenario>,
  norm: NormalisationConstants,
  estimator: string,
  spec: OutputSpec,
  batchSize: number,
  emit: (p: Prediction) => void,
): void {
  const ni = features.inputChannels;
  if (modelInputWidth(model) !== ni) {
    throw new Error(
      `${estimator} takes ${String(modelInputWidth(model))} input channels; ${features.path} (${features.featureSet}) has ${String(ni)}`,
    );
  }
  const where = new Map<number, number>();
  features.indices.forEach((idx, k) => where.set(idx, k));
  let pending: Scenario[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const x = new Float32Array(pending.length * ROWS * ni);
    pending.forEach((s, j) => {
      const k = where.get(s.metadata.index);
      if (k === undefined)
        throw new Error(`${features.path}: no window for scenario ${String(s.metadata.index)}`);
      x.set(features.read(k).inputs, j * ROWS * ni);
    });
    const y = tf.tidy(() => {
      const p = model.predict(tf.tensor3d(x, [pending.length, ROWS, ni])) as tf.Tensor;
      return p.dataSync() as Float32Array;
    });
    pending.forEach((s, j) => {
      emit(
        outputsToPrediction(
          s,
          y.subarray(j * ROWS * NO, (j + 1) * ROWS * NO),
          norm,
          estimator,
          undefined,
          spec,
        ),
      );
    });
    pending = [];
  };
  for (const s of truth) {
    pending.push(s);
    if (pending.length === batchSize) flush();
  }
  flush();
}
