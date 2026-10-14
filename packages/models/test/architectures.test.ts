import * as tf from "@tensorflow/tfjs-node";
import { describe, expect, it } from "vitest";
import { ALLOWED_LAYERS, buildModel, layerClasses, modelInputWidth } from "../src/architectures.js";
import { KINDS, tinyConfig } from "./helpers.js";

describe("architectures", () => {
  it.each(KINDS)(
    "%s maps [B, 240, 10] to [B, 240, 4] using only Keras-equivalent layers",
    (kind) => {
      const m = buildModel(tinyConfig(kind));
      const y = m.predict(tf.zeros([2, 240, 10])) as tf.Tensor;
      expect(y.shape).toEqual([2, 240, 4]);
      const used = layerClasses(m).filter((c) => c !== "InputLayer");
      expect(used.filter((c) => !ALLOWED_LAYERS.has(c))).toEqual([]);
    },
  );

  it.each(KINDS)("%s takes 13 input channels for the derived feature set (T034)", (kind) => {
    const raw = buildModel(tinyConfig(kind));
    const derived = buildModel(tinyConfig(kind, { feature_set: "derived" }));
    expect(modelInputWidth(raw)).toBe(10);
    expect(modelInputWidth(derived)).toBe(13);
    // An explicit width (the features file's) overrides the config's default.
    expect(modelInputWidth(buildModel(tinyConfig(kind), 13))).toBe(13);
    const y = derived.predict(tf.zeros([2, 240, 13])) as tf.Tensor;
    expect(y.shape).toEqual([2, 240, 4]);
    expect(() => derived.predict(tf.zeros([2, 240, 10]))).toThrow();
  });

  it.each(["instantaneous", "time_late", "causal_cnn"] as const)(
    "%s with length bucketing takes a variable time dimension at either width",
    (kind) => {
      for (const fs of ["raw", "derived"] as const) {
        const m = buildModel(tinyConfig(kind, { feature_set: fs, length_bucketing: true }));
        const w = fs === "raw" ? 10 : 13;
        expect(m.inputs[0]?.shape).toEqual([null, null, w]);
        expect((m.predict(tf.zeros([1, 57, w])) as tf.Tensor).shape).toEqual([1, 57, 4]);
      }
    },
  );

  it.each(["instantaneous", "time_late"] as const)(
    "%s stacks `layers` recurrent layers, each returning sequences (R20)",
    (kind) => {
      const one = buildModel(tinyConfig(kind, { layers: 1 }));
      const two = buildModel(tinyConfig(kind, { layers: 2 }));
      const lstms = (m: tf.LayersModel) => layerClasses(m).filter((c) => c === "LSTM").length;
      expect(lstms(one)).toBe(1);
      expect(lstms(two)).toBe(2);
      expect(lstms(buildModel(tinyConfig(kind)))).toBe(1); // absent: one layer, as before
      expect(two.countParams()).toBeGreaterThan(one.countParams());
      expect((two.predict(tf.zeros([2, 240, 10])) as tf.Tensor).shape).toEqual([2, 240, 4]);
    },
  );

  it("is reproducible from the train seed and differs with another seed", () => {
    const w = (seed: string) =>
      buildModel(tinyConfig("instantaneous", { train_seed: seed }))
        .getWeights()
        .map((t) => [...t.dataSync()]);
    expect(w("7")).toEqual(w("7"));
    expect(w("7")).not.toEqual(w("8"));
  });
});
