// The four SRD §4 models, built only from layers with direct Keras equivalents (constitution III).
// Every initializer is seeded from the run's train seed, so training is reproducible (research R2).
import * as tf from "@tensorflow/tfjs-node";
import { inputWidth, NO, outputSpec, outputWidth, ROWS } from "@tma/features";
import type { NormalisationConstants, TrainingConfig } from "@tma/types";
import { LearnedGainFilter, outputScales } from "./filter-layer.js";
import { initSeed } from "./seeds.js";

/** Model outputs per row (defined with the decoding in `@tma/features`). */
export { NO };

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
  // A declared filter layer (constitution 1.3.0; spec 012 T1): equations in filter-layer.ts.
  "LearnedGainFilter",
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

function head(next: () => number, units: number): tf.layers.Layer {
  return tf.layers.timeDistributed({
    layer: tf.layers.dense({
      units,
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
 * input. Without it the input shape stays fixed at `windowRows` (ROWS, or the features file's rows). The input width is the
 * features file's (10 raw, 13 derived; spec 003 US2), by default the config's feature set's.
 */
export function buildModel(
  config: TrainingConfig,
  inputChannels: number = inputWidth(config.feature_set ?? "raw"),
  windowRows: number = ROWS,
  /** The training data's normalisation; the learned-gain filter starts its output scales from it. */
  norm?: NormalisationConstants,
): tf.Sequential {
  const next = seeder(config);
  const no = outputWidth(outputSpec(config));
  const m = tf.sequential();
  const variable = config.length_bucketing === true;
  if (variable && config.model_kind === "mlp") {
    throw new Error(`${config.id}: length_bucketing is not supported for mlp`);
  }
  const rows = variable ? null : windowRows;
  const input = { inputShape: [rows, inputChannels] };
  switch (config.model_kind) {
    case "instantaneous":
      m.add(tf.layers.masking({ maskValue: 0, ...input }));
      // Stacked recurrent layers (capacity scan, spec 003 R20); every layer returns sequences.
      for (let l = 0; l < (config.layers ?? 1); l++) m.add(lstm(config.units, next));
      m.add(head(next, no));
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
      m.add(head(next, no));
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
      m.add(head(next, no));
      break;
    }
    case "learned_gain_filter": {
      // Tracker T1 (spec 012): the whole recursion is one declared filter layer, reading the raw
      // channels and emitting the velocity parameterisation's four channels.
      if (inputChannels !== inputWidth("raw") || outputSpec(config).parameterisation !== "velocity")
        throw new Error(
          `${config.id}: learned_gain_filter reads the raw feature set and outputs velocity`,
        );
      m.add(
        new LearnedGainFilter({
          units: config.units,
          seed: next(),
          inputShape: [rows, inputChannels],
          ...(norm === undefined ? {} : outputScales(norm, outputSpec(config).velocityScaleMps)),
        }),
      );
      break;
    }
    case "mlp":
      m.add(tf.layers.flatten({ inputShape: [windowRows, inputChannels] }));
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
          units: windowRows * no,
          kernelInitializer: tf.initializers.glorotUniform({ seed: next() }),
        }),
      );
      m.add(tf.layers.reshape({ targetShape: [windowRows, no] }));
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
