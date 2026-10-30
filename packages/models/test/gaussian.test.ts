// Spec 012 (tracker T2): the velocity_gaussian output. Means and log-variances of log range, vx
// and vy, trained by the Gaussian negative log-likelihood; decoding reports the mean and the
// standard deviations; a model trains and predicts end to end.
import * as tf from "@tensorflow/tfjs-node";
import { computeNormalisation, openFeatures, outputSpec, outputWidth, ROWS } from "@tma/features";
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { buildModel } from "../src/architectures.js";
import { LOG_VAR_MAX, makeLoss } from "../src/loss.js";
import { loadModel, outputsToPrediction, predictScenarios } from "../src/predict.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const GAUSS = { output_parameterisation: "velocity_gaussian", velocity_scale_mps: 10.29 } as const;
const spec = outputSpec(GAUSS);
const s = generateScenario(21n, 0, DEFAULT_RANGES).scenario;
const norm = computeNormalisation([s], "test");

describe("Gaussian outputs", () => {
  it("has six output channels and needs a velocity scale", () => {
    expect(outputWidth(spec)).toBe(6);
    expect(() => outputSpec({ output_parameterisation: "velocity_gaussian" })).toThrow(/scale/);
  });

  it("the loss is ½(e² e^−s + s) per term, weighted, and clips the log-variance", () => {
    // One row: log range error 0.2 with s = ln 0.04 → ½(0.04/0.04 + ln 0.04); vx, vy exact, s = 0.
    const yTrue = tf.tensor3d([[[0.5, 0.2, 0.3, 0, 1]]]);
    const yPred = tf.tensor3d([[[0.7, 0.2, 0.3, Math.log(0.04), 0, 0]]]);
    const loss = makeLoss(tinyConfig("instantaneous", { ...GAUSS, loss_weight_speed: 1 }));
    expect(loss(yTrue, yPred).dataSync()[0]).toBeCloseTo(0.5 * (1 + Math.log(0.04)), 5);
    // A huge log-variance is clipped: the term is ½ LOG_VAR_MAX, not ½ × 100.
    const wild = tf.tensor3d([[[0.5, 0.2, 0.3, 100, 0, 0]]]);
    expect(loss(yTrue, wild).dataSync()[0]).toBeCloseTo(0.5 * LOG_VAR_MAX, 4);
  });

  it("decodes the mean and the standard deviations", () => {
    const out = new Float32Array(ROWS * 6);
    for (let r = 0; r < s.metadata.samples; r++)
      out.set([Math.log(2), 0, 5 / 10.29, Math.log(0.01), Math.log(0.04), Math.log(0.09)], r * 6);
    const p = outputsToPrediction(s, out, norm, "g", 0, spec);
    const ok = p.rows.filter((r) => r.converged);
    expect(ok.length).toBeGreaterThan(s.metadata.samples / 2);
    for (const row of ok) {
      expect(row.range_m).toBeCloseTo(2000, 0);
      expect(row.speed_mps).toBeCloseTo(5, 4);
      expect(row.log_range_sd).toBeCloseTo(0.1, 6);
      expect(row.vx_sd_mps).toBeCloseTo(0.2 * 10.29, 4);
      expect(row.vy_sd_mps).toBeCloseTo(0.3 * 10.29, 4);
    }
  });

  it("builds a six-channel head, trains and predicts end to end", async () => {
    const m = buildModel(tinyConfig("instantaneous", { ...GAUSS, feature_set: "raw" }));
    expect(m.outputs[0]?.shape.at(-1)).toBe(6);
    m.dispose();
    const data = tinyFeatures(24);
    const out = tempDir();
    const cfg = tinyConfig("instantaneous", { ...GAUSS, max_epochs: 1 });
    const trained = await train({
      config: cfg,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: () => undefined,
      source: { commit: "c".repeat(40), dirty: false },
    });
    expect(Number.isFinite(trained.best_val_loss ?? NaN)).toBe(true);
    const model = await loadModel(out);
    const f = openFeatures(data.val);
    try {
      const ss = Array.from(
        { length: 3 },
        (_, i) => generateScenario(3n, 10_000 + i, DEFAULT_RANGES).scenario,
      );
      for (const p of predictScenarios(
        model,
        f,
        ss,
        f.norm,
        trained.id,
        outputSpec(trained.config),
      ))
        for (const r of p.rows) {
          expect(Number.isFinite(r.speed_mps)).toBe(true);
          expect(r.log_range_sd).toBeGreaterThan(0);
        }
    } finally {
      f.close();
      model.dispose();
    }
  });
});
