// Seeded batch assembly from a features file (research R6, R15). Pure apart from file reads.
import { type FeatureFile, NI, NT, ROWS, type Window } from "@tma/features";
import { createRng, nextU32 } from "@tma/sim";
import type { TrainingConfig } from "@tma/types";
import { NO } from "./architectures.js";
import { NY } from "./loss.js";
import { bucketSeed, epochSeed, shuffleSeed } from "./seeds.js";

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

/** Default batches per length-bucketing group (research R15). */
export const DEFAULT_BUCKET_BATCHES = 16;

export const bucketing = (config: TrainingConfig): boolean => config.length_bucketing === true;

/** Refuses length-bucketing settings the trainer cannot honour. */
export function checkBucketing(config: TrainingConfig): void {
  if (!bucketing(config)) return;
  if (config.model_kind === "mlp") {
    throw new Error(
      `${config.id}: length_bucketing is not supported for mlp (its dense layers read all ${String(ROWS)} rows, so it cannot take a variable time dimension)`,
    );
  }
  const g = config.bucket_batches ?? DEFAULT_BUCKET_BATCHES;
  if (!Number.isInteger(g) || g < 1) {
    throw new Error(`${config.id}: bucket_batches must be a positive integer`);
  }
}

/**
 * Rows a window occupies: one past its last row with any non-zero input. Padding rows are all
 * zero (buildWindow), so every later row is padding; dropout rows keep ownship and time channels
 * and so are never mistaken for padding.
 */
export function windowLength(inputs: Float32Array): number {
  for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < NI; c++) if ((inputs[r * NI + c] ?? 0) !== 0) return r + 1;
  }
  return 0;
}

/** Length of each of the first `n` windows of a features file. */
export function windowLengths(file: FeatureFile, n: number): Uint16Array {
  const out = new Uint16Array(n);
  for (let k = 0; k < n; k++) out[k] = windowLength(file.read(k).inputs);
  return out;
}

/**
 * The window indices of each batch of epoch `epoch`, in training order.
 *
 * Without length bucketing: consecutive slices of the epoch's seeded permutation (iteration 1).
 * With it (R15): each group of bucket_batches × batch_size windows of that permutation is sorted
 * by length (ties keep their permutation order), cut into batches, and the order of all the
 * epoch's batches is then shuffled with a seed derived from (train_seed, epoch). Only the last
 * group can hold a short batch. `lengths` is required when bucketing.
 */
export function epochBatches(
  config: TrainingConfig,
  epoch: number,
  n: number,
  lengths?: ArrayLike<number>,
): Uint32Array[] {
  const order = epochOrder(config, epoch, n);
  const bs = config.batch_size;
  if (!bucketing(config)) {
    const out: Uint32Array[] = [];
    for (let s = 0; s < n; s += bs) out.push(order.subarray(s, Math.min(n, s + bs)));
    return out;
  }
  if (lengths === undefined) throw new Error("length bucketing needs window lengths");
  const group = bs * (config.bucket_batches ?? DEFAULT_BUCKET_BATCHES);
  const cut: Uint32Array[] = [];
  for (let g = 0; g < n; g += group) {
    const members = Array.from(order.subarray(g, Math.min(n, g + group)), (k, pos) => ({
      k,
      pos,
    }));
    members.sort((a, b) => (lengths[a.k] ?? 0) - (lengths[b.k] ?? 0) || a.pos - b.pos);
    for (let s = 0; s < members.length; s += bs) {
      cut.push(Uint32Array.from(members.slice(s, s + bs), (m) => m.k));
    }
  }
  const shuffle = permutation(bucketSeed(config.train_seed, epoch), cut.length);
  return Array.from(shuffle, (i) => cut[i] ?? new Uint32Array(0));
}

/** Rows a training batch needs: ROWS, or with bucketing its longest window (at least 1). */
export function batchRows(
  config: TrainingConfig,
  ks: ArrayLike<number>,
  lengths?: ArrayLike<number>,
): number {
  if (!bucketing(config) || lengths === undefined) return ROWS;
  let rows = 1;
  for (let j = 0; j < ks.length; j++) rows = Math.max(rows, lengths[ks[j] ?? 0] ?? ROWS);
  return rows;
}

export interface Batch {
  x: Float32Array;
  y: Float32Array;
  size: number;
  /** Rows per window in x and y: ROWS, or fewer when trimmed by length bucketing. */
  rows: number;
}

/**
 * Pack windows `ks` into x [B, rows, 10] and y [B, rows, 5] (targets 0–3 + row weight). With
 * `rows` below ROWS the trailing rows are dropped; the caller guarantees they are padding in every
 * window (batchRows), so they carried zero loss weight.
 */
export function makeBatch(
  file: FeatureFile,
  ks: ArrayLike<number>,
  config: TrainingConfig,
  labels: Uint32Array,
  rows: number = ROWS,
): Batch {
  const b = ks.length;
  const x = new Float32Array(b * rows * NI);
  const y = new Float32Array(b * rows * NY);
  const causal = isCausal(config);
  for (let j = 0; j < b; j++) {
    const k = ks[j] ?? 0;
    const w: Window = file.read(k);
    const lk = labels[k] ?? k;
    const lw: Window = lk === k ? w : file.read(lk);
    x.set(rows === ROWS ? w.inputs : w.inputs.subarray(0, rows * NI), j * rows * NI);
    for (let r = 0; r < rows; r++) {
      const windowMask = (w.inputs[r * NI + NI - 1] ?? 0) * (lw.inputs[r * NI + NI - 1] ?? 0);
      const weight = causal ? windowMask * (lw.lossMask[r] ?? 0) : windowMask;
      const o = (j * rows + r) * NY;
      for (let c = 0; c < NO; c++) y[o + c] = lw.targets[r * NT + c] ?? 0;
      y[o + NO] = weight;
    }
  }
  return { x, y, size: b, rows };
}
