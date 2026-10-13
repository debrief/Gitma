import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeNormalisation, type FeatureSource, writeFeatures } from "@tma/features";
import { DEFAULT_RANGES, GENERATOR_VERSION, generateScenario } from "@tma/sim";
import {
  type DatasetHeader,
  type FeatureSet,
  type ModelKind,
  SCHEMA_VERSION,
  type Split,
  type TrainingConfig,
} from "@tma/types";

export const tempDir = (): string => mkdtempSync(join(tmpdir(), "tma-models-"));

/** Commit named by test fixtures for both the G0 verdict and the dataset headers. */
export const VERIFIED_COMMIT = "f".repeat(40);

/** Source dataset (format v2 lineage) for features written from in-memory scenarios. */
export function testSource(
  split: Split,
  seed: bigint,
  count: number,
  over: Partial<DatasetHeader> = {},
): FeatureSource {
  return {
    header: {
      record: "header",
      schema_version: SCHEMA_VERSION,
      generator_version: GENERATOR_VERSION,
      dataset_seed: seed.toString(),
      split,
      scenario_count: count,
      index_start: 0,
      index_end: count,
      parameter_ranges: DEFAULT_RANGES,
      redraw_count: 0,
      created_by: "test",
      generator_git_commit: VERIFIED_COMMIT,
      generator_git_dirty: false,
      ...over,
    },
    digest: "e".repeat(64),
  };
}

/** An experiments folder holding one passing G0 verdict at VERIFIED_COMMIT. */
export function g0Experiments(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "g0"));
  writeFileSync(
    join(dir, "g0", "verdict.json"),
    JSON.stringify({
      gate: "G0",
      result: "pass",
      checks: [],
      decided_by: "agent review panel, round 1 (no rejections; test fixture)",
    }),
  );
  writeFileSync(join(dir, "g0", "review.md"), "# G0 agent panel review (test fixture)\n");
  writeFileSync(
    join(dir, "g0", "manifest.json"),
    JSON.stringify({
      id: "g0",
      created: "2026-10-13T00:00:00Z",
      git_commit: VERIFIED_COMMIT,
      git_dirty: false,
      schema_version: SCHEMA_VERSION,
      generator_version: GENERATOR_VERSION,
      datasets: [],
      estimators: [],
      command_lines: [],
    }),
  );
  return dir;
}

/** Git checks for fixtures: only VERIFIED_COMMIT's generator matches. */
export const FIXTURE_GIT = {
  generatorUnchanged: (c: string): boolean => c === VERIFIED_COMMIT,
  generatorPathsEqual: (a: string, b: string): boolean => a === b && a === VERIFIED_COMMIT,
};

/** Small train/validation features files from seed `seed`, carrying lineage (format v2). */
export function tinyFeatures(
  n: number,
  seed = 3n,
  featureSet: FeatureSet = "raw",
): { train: string; val: string } {
  const dir = tempDir();
  const tr = Array.from(
    { length: n },
    (_, i) => generateScenario(seed, i, DEFAULT_RANGES).scenario,
  );
  const va = Array.from(
    { length: 16 },
    (_, i) => generateScenario(seed, 10_000 + i, DEFAULT_RANGES).scenario,
  );
  const norm = computeNormalisation(tr, "test", featureSet);
  const train = join(dir, "train.features.bin");
  const val = join(dir, "val.features.bin");
  writeFeatures(train, () => tr, norm, testSource("train", seed, n), featureSet);
  writeFeatures(val, () => va, norm, testSource("validation", seed, 16), featureSet);
  return { train, val };
}

export function tinyConfig(kind: ModelKind, over: Partial<TrainingConfig> = {}): TrainingConfig {
  return {
    id: `test-${kind}`,
    model_kind: kind,
    units: 8,
    kernel_size: 3,
    layers: 2,
    learning_rate: 1e-3,
    batch_size: 16,
    max_epochs: 2,
    patience: 5,
    max_wall_s: 600,
    loss_weight_range: 1,
    loss_weight_course: 1,
    loss_weight_speed: 1,
    train_seed: "7",
    shuffle_labels: false,
    ...over,
  };
}

export const KINDS: ModelKind[] = ["instantaneous", "time_late", "causal_cnn", "mlp"];
