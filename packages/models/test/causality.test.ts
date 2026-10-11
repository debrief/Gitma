import * as tf from "@tensorflow/tfjs-node";
import { describe, expect, it } from "vitest";
import { buildModel } from "../src/architectures.js";
import { tinyConfig } from "./helpers.js";

/** Outputs for rows ≤ t, before and after perturbing every input after t. */
function rowsUpTo(
  kind: Parameters<typeof tinyConfig>[0],
  t: number,
): [number[], number[], number[], number[]] {
  const m = buildModel(tinyConfig(kind, { units: 6 }));
  const base = tf.randomUniform([1, 240, 10], 0.1, 1, "float32", 3);
  const mask = tf.concat([tf.zeros([1, t + 1, 10]), tf.ones([1, 239 - t, 10])], 1);
  const pert = base.add(mask.mul(tf.randomUniform([1, 240, 10], 0.5, 1, "float32", 4)));
  const a = m.predict(base) as tf.Tensor;
  const b = m.predict(pert) as tf.Tensor;
  return [
    [...a.slice([0, 0, 0], [1, t + 1, 4]).dataSync()],
    [...b.slice([0, 0, 0], [1, t + 1, 4]).dataSync()],
    [...a.dataSync()],
    [...b.dataSync()],
  ];
}

describe("causality (FR-006)", () => {
  it.each(["instantaneous", "causal_cnn"] as const)(
    "%s: rows ≤ t ignore inputs after t",
    (kind) => {
      const [a, b, fa, fb] = rowsUpTo(kind, 100);
      expect(b).toEqual(a);
      expect(fb).not.toEqual(fa);
    },
  );

  it.each(["time_late", "mlp"] as const)("%s: rows ≤ t do depend on later inputs", (kind) => {
    const [a, b] = rowsUpTo(kind, 100);
    expect(b).not.toEqual(a);
  });
});
