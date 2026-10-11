import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeNormalisation, writeFeatures } from "@tma/features";
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import type { ModelKind, TrainingConfig } from "@tma/types";

export const tempDir = (): string => mkdtempSync(join(tmpdir(), "tma-models-"));

/** Small train/validation features files from seed `seed`. */
export function tinyFeatures(n: number, seed = 3n): { train: string; val: string } {
  const dir = tempDir();
  const tr = Array.from(
    { length: n },
    (_, i) => generateScenario(seed, i, DEFAULT_RANGES).scenario,
  );
  const va = Array.from(
    { length: 16 },
    (_, i) => generateScenario(seed, 10_000 + i, DEFAULT_RANGES).scenario,
  );
  const norm = computeNormalisation(tr, "test");
  const train = join(dir, "train.features.bin");
  const val = join(dir, "val.features.bin");
  writeFeatures(train, () => tr, norm);
  writeFeatures(val, () => va, norm);
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
