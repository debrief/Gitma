// The four SRD §4 models, built only from layers with direct Keras equivalents (constitution III).
// Every initializer is seeded from the run's train seed, so training is reproducible (research R2).
import * as tf from "@tensorflow/tfjs-node";
import { inputWidth, ROWS } from "@tma/features";
import type { TrainingConfig } from "@tma/types";
import { initSeed } from "./seeds.js";

/** Model outputs per row: log_range_km, course_sin, course_cos, speed_scaled. */
export const NO = 4;

/** Keras layer classes the models may use (checked by tests). */
export const ALLOWED_LAYERS = new Set([
  "Masking",
  "LSTM",
  "Bidirectional",
  "TimeDistributed",
  "Dense",
  "Conv1D",
  "Reshape",
  "ZeroPadding2D",
  "Flatten",
]);

function seeder(config: TrainingConfig): () => number {
  let i = 0;
  return () => initSeed(config.train_seed, i++);
}

function lstm(units: number, next: () => number): tf.layers.Layer {
  return tf.layers.lstm({
    units,
    returnSequences: true,
    kernelInitializer: tf.initializers.glorotUniform({ seed: next() }),
    recurrentInitializer: tf.initializers.orthogonal({ seed: next() }),
  });
}

function head(next: () => number): tf.layers.Layer {
  return tf.layers.timeDistributed({
    layer: tf.layers.dense({
      units: NO,
      kernelInitializer: tf.initializers.glorotUniform({ seed: next() }),
    }),
  });
}

/**
 * Left-pads `pad` rows (tfjs ignores padding: "causal" — research R3). `rows` null means a
 * variable time dimension (length bucketing), which the reshapes infer (-1).
 */
function causalPad(m: tf.Sequential, rows: number | null, channels: number, pad: number): void {
  m.add(tf.layers.reshape({ targetShape: [rows ?? -1, 1, channels] }));
  m.add(
    tf.layers.zeroPadding2d({
      padding: [
        [pad, 0],
        [0, 0],
      ],
    }),
  );
  m.add(tf.layers.reshape({ targetShape: [rows === null ? -1 : rows + pad, channels] }));
}

/**
 * Builds a model. With length bucketing the time dimension is variable (null): the layers, their
 * parameters and their seeded initial values are unchanged, and so are the outputs on full-length
 * input. Without it the input shape stays fixed at ROWS (iteration 1). The input width is the
 * features file's (10 raw, 13 derived; spec 003 US2), by default the config's feature set's.
 */
export function buildModel(
  config: TrainingConfig,
  inputChannels: number = inputWidth(config.feature_set ?? "raw"),
): tf.Sequential {
  const next = seeder(config);
  const m = tf.sequential();
  const variable = config.length_bucketing === true;
  if (variable && config.model_kind === "mlp") {
    throw new Error(`${config.id}: length_bucketing is not supported for mlp`);
  }
  const rows = variable ? null : ROWS;
  const input = { inputShape: [rows, inputChannels] };
  switch (config.model_kind) {
    case "instantaneous":
      m.add(tf.layers.masking({ maskValue: 0, ...input }));
      // Stacked recurrent layers (capacity scan, spec 003 R20); every layer returns sequences.
      for (let l = 0; l < (config.layers ?? 1); l++) m.add(lstm(config.units, next));
      m.add(head(next));
      break;
    case "time_late":
      m.add(tf.layers.masking({ maskValue: 0, ...input }));
      for (let l = 0; l < (config.layers ?? 1); l++) {
        m.add(
          tf.layers.bidirectional({
            layer: lstm(config.units, next) as tf.RNN,
            mergeMode: "concat",
          }),
        );
      }
      m.add(head(next));
      break;
    case "causal_cnn": {
      const k = config.kernel_size ?? 9;
      const layers = config.layers ?? 3;
      m.add(tf.layers.inputLayer(input));
      let channels: number = inputChannels;
      // No dilation: tfjs has no gradient for dilated convolutions, so width comes from the kernel.
      for (let l = 0; l < layers; l++) {
        causalPad(m, rows, channels, k - 1);
        m.add(
          tf.layers.conv1d({
            filters: config.units,
            kernelSize: k,
            padding: "valid",
            activation: "relu",
            kernelInitializer: tf.initializers.glorotUniform({ seed: next() }),
          }),
        );
        channels = config.units;
      }
      m.add(head(next));
      break;
    }
    case "mlp":
      m.add(tf.layers.flatten({ inputShape: [ROWS, inputChannels] }));
      for (let l = 0; l < 2; l++) {
        m.add(
          tf.layers.dense({
            units: config.units,
            activation: "relu",
            kernelInitializer: tf.initializers.glorotUniform({ seed: next() }),
          }),
        );
      }
      m.add(
        tf.layers.dense({
          units: ROWS * NO,
          kernelInitializer: tf.initializers.glorotUniform({ seed: next() }),
        }),
      );
      m.add(tf.layers.reshape({ targetShape: [ROWS, NO] }));
      break;
  }
  return m;
}

/** Input channels per row a model takes (the last dimension of its input). */
export function modelInputWidth(m: tf.LayersModel): number {
  const shape = m.inputs[0]?.shape;
  const w = shape?.[shape.length - 1];
  if (typeof w !== "number") throw new Error("model has no fixed input width");
  return w;
}

/** Layer class names used by a model, including wrapped layers. */
export function layerClasses(m: tf.LayersModel): string[] {
  const out: string[] = [];
  for (const l of m.layers) {
    out.push(l.getClassName());
    const inner = (l as unknown as { layer?: tf.layers.Layer }).layer;
    if (inner !== undefined) out.push(inner.getClassName());
  }
  return out;
}
