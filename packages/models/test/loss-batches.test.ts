import * as tf from "@tensorflow/tfjs-node";
import { openFeatures } from "@tma/features";
import { describe, expect, it } from "vitest";
import { epochOrder, labelMap, makeBatch, permutation } from "../src/batches.js";
import { makeLoss } from "../src/loss.js";
import { tinyConfig, tinyFeatures } from "./helpers.js";

describe("masked loss", () => {
  it("matches a hand computation and ignores zero-weight rows", () => {
    const cfg = tinyConfig("instantaneous", {
      loss_weight_range: 2,
      loss_weight_course: 1,
      loss_weight_speed: 3,
    });
    const yTrue = tf.zeros([1, 240, 5]).arraySync() as number[][][];
    const yPred = tf.zeros([1, 240, 4]).arraySync() as number[][][];
    const row = (r: number) => yTrue[0]?.[r] ?? [];
    const prow = (r: number) => yPred[0]?.[r] ?? [];
    row(0)[4] = 1; // weighted row
    prow(0)[0] = 1; // Δlog r = 1 → 2
    prow(0)[1] = 1; // Δsin = 1 → 1
    prow(0)[3] = 1; // Δspeed = 1 → 3
    prow(5)[0] = 100; // unweighted row: ignored
    const l = makeLoss(cfg)(tf.tensor3d(yTrue), tf.tensor3d(yPred));
    expect(l.dataSync()[0]).toBeCloseTo(6, 6);
  });
});

describe("batches", () => {
  const { train } = tinyFeatures(20);
  const f = openFeatures(train);

  it("permutations are seeded and complete", () => {
    const p = permutation(5n, 100);
    expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(permutation(5n, 100)).toEqual(p);
    const cfg = tinyConfig("instantaneous");
    expect(epochOrder(cfg, 0, 20)).not.toEqual(epochOrder(cfg, 1, 20));
  });

  it("causal weights are the post-zig mask; non-causal weights the window mask", () => {
    const w0 = f.read(0);
    const causal = makeBatch(
      f,
      [0],
      tinyConfig("instantaneous"),
      labelMap(tinyConfig("instantaneous"), 20),
    );
    const nonCausal = makeBatch(
      f,
      [0],
      tinyConfig("time_late"),
      labelMap(tinyConfig("time_late"), 20),
    );
    const weights = (y: Float32Array) => Array.from({ length: 240 }, (_, r) => y[r * 5 + 4]);
    expect(weights(causal.y)).toEqual([...w0.lossMask]);
    expect(weights(nonCausal.y)).toEqual(
      Array.from({ length: 240 }, (_, r) => w0.inputs[r * 10 + 9]),
    );
  });

  it("shuffled labels move targets across scenarios but keep inputs", () => {
    const cfg = tinyConfig("instantaneous", { shuffle_labels: true });
    const labels = labelMap(cfg, 20);
    const k = [...labels].findIndex((v, i) => v !== i);
    expect(k).toBeGreaterThanOrEqual(0);
    const b = makeBatch(f, [k], cfg, labels);
    expect([...b.x]).toEqual([...f.read(k).inputs]);
    const src = f.read(labels[k] ?? 0);
    expect(b.y[0]).toBeCloseTo(src.targets[0] ?? NaN, 6);
  });
});
