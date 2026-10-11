import * as tf from "@tensorflow/tfjs-node";
import { describe, expect, it } from "vitest";
import { ALLOWED_LAYERS, buildModel, layerClasses } from "../src/architectures.js";
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

  it("is reproducible from the train seed and differs with another seed", () => {
    const w = (seed: string) =>
      buildModel(tinyConfig("instantaneous", { train_seed: seed }))
        .getWeights()
        .map((t) => [...t.dataSync()]);
    expect(w("7")).toEqual(w("7"));
    expect(w("7")).not.toEqual(w("8"));
  });
});
