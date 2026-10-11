// Seeded batch assembly from a features file (research R6). Pure apart from file reads.
import { type FeatureFile, NI, NT, ROWS, type Window } from "@tma/features";
import { createRng, nextU32 } from "@tma/sim";
import type { TrainingConfig } from "@tma/types";
import { NO } from "./architectures.js";
import { NY } from "./loss.js";
import { epochSeed, shuffleSeed } from "./seeds.js";

/** Seeded Fisher–Yates permutation of [0, n). */
export function permutation(seed: bigint, n: number): Uint32Array {
  const p = new Uint32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const s = createRng(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = nextU32(s) % (i + 1);
    const t = p[i] ?? 0;
    p[i] = p[j] ?? 0;
    p[j] = t;
  }
  return p;
}

export const epochOrder = (config: TrainingConfig, epoch: number, n: number): Uint32Array =>
  permutation(epochSeed(config.train_seed, epoch), n);

/** Causal models learn only after the zig; non-causal models on every window row (R5). */
export const isCausal = (config: TrainingConfig): boolean =>
  config.model_kind === "instantaneous" || config.model_kind === "causal_cnn";

/** Label source for each window: identity, or a fixed seeded permutation for the leakage run. */
export function labelMap(config: TrainingConfig, n: number): Uint32Array {
  if (config.shuffle_labels) return permutation(shuffleSeed(config.train_seed), n);
  const id = new Uint32Array(n);
  for (let i = 0; i < n; i++) id[i] = i;
  return id;
}

export interface Batch {
  x: Float32Array;
  y: Float32Array;
  size: number;
}

/** Pack windows `ks` into x [B, 240, 10] and y [B, 240, 5] (targets 0–3 + row weight). */
export function makeBatch(
  file: FeatureFile,
  ks: ArrayLike<number>,
  config: TrainingConfig,
  labels: Uint32Array,
): Batch {
  const b = ks.length;
  const x = new Float32Array(b * ROWS * NI);
  const y = new Float32Array(b * ROWS * NY);
  const causal = isCausal(config);
  for (let j = 0; j < b; j++) {
    const k = ks[j] ?? 0;
    const w: Window = file.read(k);
    const lk = labels[k] ?? k;
    const lw: Window = lk === k ? w : file.read(lk);
    x.set(w.inputs, j * ROWS * NI);
    for (let r = 0; r < ROWS; r++) {
      const windowMask = (w.inputs[r * NI + NI - 1] ?? 0) * (lw.inputs[r * NI + NI - 1] ?? 0);
      const weight = causal ? windowMask * (lw.lossMask[r] ?? 0) : windowMask;
      const o = (j * ROWS + r) * NY;
      for (let c = 0; c < NO; c++) y[o + c] = lw.targets[r * NT + c] ?? 0;
      y[o + NO] = weight;
    }
  }
  return { x, y, size: b };
}
