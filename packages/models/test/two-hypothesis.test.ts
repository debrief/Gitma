// Spec 011: the velocity_two_hypothesis output. The turn label comes from the stored truth course;
// each hypothesis is trained only where it is true; decoding reports the more probable hypothesis
// (never an average) and its probability; a model trains and predicts end to end.
import { readFileSync } from "node:fs";
import * as tf from "@tensorflow/tfjs-node";
import {
  buildWindow,
  computeNormalisation,
  encodeTargets,
  NT,
  openFeatures,
  outputSpec,
  outputWidth,
  ROWS,
  turnedLabel,
} from "@tma/features";
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import type { ParameterRanges, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { buildModel } from "../src/architectures.js";
import { labelMap, makeBatch } from "../src/batches.js";
import { makeLoss, NY } from "../src/loss.js";
import { loadModel, outputsToPrediction, predictScenarios } from "../src/predict.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const TWO = {
  output_parameterisation: "velocity_two_hypothesis",
  velocity_scale_mps: 10.29,
} as const;
const spec = outputSpec(TWO);
const PHASE3 = JSON.parse(
  readFileSync(new URL("../../../configs/phase3-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const scen: Scenario[] = Array.from(
  { length: 30 },
  (_, i) => generateScenario(21n, i, PHASE3).scenario,
);
const turning = scen.find((s) => s.metadata.manoeuvre_start_index != null);
const held = scen.find((s) => s.metadata.manoeuvre_start_index == null);
if (turning === undefined || held === undefined) throw new Error("need both kinds");
const norm = computeNormalisation(scen, "test");

describe("two-hypothesis outputs", () => {
  it("has seven output channels and needs a velocity scale", () => {
    expect(outputWidth(spec)).toBe(7);
    expect(() => outputSpec({ output_parameterisation: "velocity_two_hypothesis" })).toThrow(
      /scale/,
    );
  });

  it("labels rows from the turn's start, from the stored truth course alone", () => {
    const m = turning.metadata;
    const w = buildWindow(turning, norm);
    const start = m.manoeuvre_start_index ?? NaN;
    for (let r = 0; r < m.samples; r++)
      expect(turnedLabel(w.targets, r * NT), `row ${String(r)}`).toBe(r >= start ? 1 : 0);
    const h = buildWindow(held, norm);
    for (let r = 0; r < held.metadata.samples; r++) expect(turnedLabel(h.targets, r * NT)).toBe(0);
    const out = new Float32Array(4);
    encodeTargets(w.targets, start * NT, norm, spec, out, 0);
    expect(out[3]).toBe(1);
  });

  it("decodes the more probable hypothesis, never an average, and records its probability", () => {
    const n = turning.metadata.samples;
    const out = new Float32Array(ROWS * 7);
    for (let r = 0; r < n; r++) {
      const o = r * 7;
      // Hypothesis 0: 2 km heading north at 5 m/s; hypothesis 1: 4 km heading east at 5 m/s.
      out.set([Math.log(2), 0, 5 / 10.29, Math.log(4), 5 / 10.29, 0, r % 2 === 0 ? -3 : 3], o);
    }
    const p = outputsToPrediction(turning, out, norm, "two", 0, spec);
    for (const row of p.rows) {
      const i = Math.round(row.timestamp_s / turning.metadata.parameters.dt_s);
      const turnedWins = i % 2 === 1;
      expect(row.range_m).toBeCloseTo(turnedWins ? 4000 : 2000, 0);
      expect(row.course_rad).toBeCloseTo(turnedWins ? Math.PI / 2 : 0, 5);
      expect(row.speed_mps).toBeCloseTo(5, 4);
      expect(row.p_manoeuvre).toBeCloseTo(
        turnedWins ? 1 / (1 + Math.exp(-3)) : 1 / (1 + Math.exp(3)),
        6,
      );
    }
    expect(() =>
      outputsToPrediction(turning, new Float32Array(ROWS * 4), norm, "two", 0, spec),
    ).toThrow(/expected/);
  });

  it("the loss trains each hypothesis only where it is true, plus the weighted cross-entropy", () => {
    // One row, label 1: hypothesis 0 is wrong (ignored), hypothesis 1 is exact; logit 0 → BCE ln 2.
    const yTrue = tf.tensor3d([[[0.5, 0.2, 0.3, 1, 1]]]);
    const good = [0.5, 0.2, 0.3];
    const yPred = tf.tensor3d([[[9, 9, 9, ...good, 0]]]);
    const loss = makeLoss(tinyConfig("instantaneous", { ...TWO, loss_weight_manoeuvre: 2 }));
    expect(loss(yTrue, yPred).dataSync()[0]).toBeCloseTo(2 * Math.log(2), 6);
    // Label 0: now hypothesis 1 is ignored and hypothesis 0's error counts (weights 1, 1, 1).
    const y0 = tf.tensor3d([[[0.5, 0.2, 0.3, 0, 1]]]);
    const p0 = tf.tensor3d([[[0.5, 0.2, 1.3, 9, 9, 9, 0]]]);
    expect(loss(y0, p0).dataSync()[0]).toBeCloseTo(1 + 2 * Math.log(2), 6);
  });

  it("builds a seven-channel head and batches carry the label", () => {
    const m = buildModel(tinyConfig("instantaneous", { ...TWO, feature_set: "raw" }));
    expect(m.outputs[0]?.shape.at(-1)).toBe(7);
    m.dispose();
    const { train: path } = tinyFeatures(4);
    const f = openFeatures(path);
    try {
      const cfg = tinyConfig("instantaneous", TWO);
      const b = makeBatch(f, [0], cfg, labelMap(cfg, f.count));
      expect(b.y.length).toBe(ROWS * NY);
      for (let r = 0; r < ROWS; r++) expect([0, 1]).toContain(b.y[r * NY + 3]);
    } finally {
      f.close();
    }
  });

  it("trains and predicts end to end", async () => {
    const data = tinyFeatures(24);
    const out = tempDir();
    const cfg = tinyConfig("instantaneous", { ...TWO, max_epochs: 1 });
    const m = await train({
      config: cfg,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: () => undefined,
      source: { commit: "c".repeat(40), dirty: false },
    });
    expect(Number.isFinite(m.best_val_loss ?? NaN)).toBe(true);
    const model = await loadModel(out);
    const f = openFeatures(data.val);
    try {
      const ss = Array.from(
        { length: 3 },
        (_, i) => generateScenario(3n, 10_000 + i, DEFAULT_RANGES).scenario,
      );
      const ps = predictScenarios(model, f, ss, f.norm, m.id, outputSpec(m.config));
      for (const p of ps)
        for (const r of p.rows) {
          expect(Number.isFinite(r.speed_mps)).toBe(true);
          expect(r.p_manoeuvre).toBeGreaterThanOrEqual(0);
          expect(r.p_manoeuvre).toBeLessThanOrEqual(1);
        }
    } finally {
      f.close();
      model.dispose();
    }
  });
});
