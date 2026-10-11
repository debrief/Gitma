// The four SRD §4 models, built only from layers with direct Keras equivalents (constitution III).
// Every initializer is seeded from the run's train seed, so training is reproducible (research R2).
import * as tf from "@tensorflow/tfjs-node";
import { NI, ROWS } from "@tma/features";
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

/** Left-pads `pad` rows (tfjs ignores padding: "causal" — research R3). */
function causalPad(m: tf.Sequential, rows: number, channels: number, pad: number): void {
  m.add(tf.layers.reshape({ targetShape: [rows, 1, channels] }));
  m.add(
    tf.layers.zeroPadding2d({
      padding: [
        [pad, 0],
        [0, 0],
      ],
    }),
  );
  m.add(tf.layers.reshape({ targetShape: [rows + pad, channels] }));
}

export function buildModel(config: TrainingConfig): tf.Sequential {
  const next = seeder(config);
  const m = tf.sequential();
  const input = { inputShape: [ROWS, NI] };
  switch (config.model_kind) {
    case "instantaneous":
      m.add(tf.layers.masking({ maskValue: 0, ...input }));
      m.add(lstm(config.units, next));
      m.add(head(next));
      break;
    case "time_late":
      m.add(tf.layers.masking({ maskValue: 0, ...input }));
      m.add(
        tf.layers.bidirectional({ layer: lstm(config.units, next) as tf.RNN, mergeMode: "concat" }),
      );
      m.add(head(next));
      break;
    case "causal_cnn": {
      const k = config.kernel_size ?? 9;
      const layers = config.layers ?? 3;
      m.add(tf.layers.inputLayer({ inputShape: [ROWS, NI] }));
      let channels: number = NI;
      // No dilation: tfjs has no gradient for dilated convolutions, so width comes from the kernel.
      for (let l = 0; l < layers; l++) {
        causalPad(m, ROWS, channels, k - 1);
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
      m.add(tf.layers.flatten(input));
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
