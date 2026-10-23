// Spec 008: the velocity output parameterisation. Truth-valued velocity outputs decode to the
// truth; the loss weights each component by loss_weight_speed and ignores the fourth output;
// batches carry velocity targets; a velocity model trains and predicts end to end.
import * as tf from "@tensorflow/tfjs-node";
import { rowError } from "@tma/eval";
import {
  buildWindow,
  computeNormalisation,
  COURSE_SPEED,
  encodeTargets,
  NT,
  openFeatures,
  outputSpec,
  ROWS,
} from "@tma/features";
import { DEFAULT_RANGES, generateScenario, noiseFree } from "@tma/sim";
import type { Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { NO } from "../src/architectures.js";
import { labelMap, makeBatch } from "../src/batches.js";
import { makeLoss, NY } from "../src/loss.js";
import { loadModel, outputsToPrediction, predictScenarios } from "../src/predict.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const VELOCITY = { output_parameterisation: "velocity", velocity_scale_mps: 10.29 } as const;
const spec = outputSpec(VELOCITY);
const scenarios: Scenario[] = Array.from(
  { length: 8 },
  (_, i) => generateScenario(11n, i, noiseFree(DEFAULT_RANGES)).scenario,
);
const norm = computeNormalisation(scenarios, "test");

function encoded(s: Scenario): Float32Array {
  const w = buildWindow(s, norm);
  const out = new Float32Array(ROWS * NO);
  for (let r = 0; r < ROWS; r++) encodeTargets(w.targets, r * NT, norm, spec, out, r * NO);
  return out;
}

describe("velocity outputs", () => {
  it("outputSpec defaults to course_speed and refuses velocity without a scale", () => {
    expect(outputSpec({})).toBe(COURSE_SPEED);
    expect(() => outputSpec({ output_parameterisation: "velocity" })).toThrow(/velocity_scale_mps/);
    expect(() =>
      outputSpec({ output_parameterisation: "velocity", velocity_scale_mps: 0 }),
    ).toThrow(/velocity_scale_mps/);
  });

  it("truth-valued velocity outputs decode to the truth on every post-zig row", () => {
    for (const s of scenarios) {
      const p = outputsToPrediction(s, encoded(s), norm, "perfect", undefined, spec);
      for (const row of p.rows) {
        const e = rowError(s, row);
        expect(e.gross).toBe(false);
        expect(e.course_deg).toBeLessThan(1e-3);
        expect(e.speed_kt).toBeLessThan(1e-4);
      }
    }
  });

  it("encodes vx east and vy north, scaled, with a zero fourth channel", () => {
    const stored = [
      Math.log(5),
      Math.sin(Math.PI / 2),
      Math.cos(Math.PI / 2),
      6 / norm.speed_scale_mps,
    ];
    const out = new Float32Array(4);
    encodeTargets(stored, 0, norm, spec, out, 0);
    expect(out[0]).toBeCloseTo(Math.log(5), 6);
    expect(out[1]).toBeCloseTo(6 / 10.29, 6); // due east at 6 m/s
    expect(out[2]).toBeCloseTo(0, 6);
    expect(out[3]).toBe(0);
  });

  it("loss weights each component by loss_weight_speed and ignores the fourth output", () => {
    const cfg = tinyConfig("instantaneous", {
      ...VELOCITY,
      loss_weight_range: 2,
      loss_weight_course: 100,
      loss_weight_speed: 3,
    });
    const yTrue = tf.zeros([1, 240, 5]).arraySync() as number[][][];
    const yPred = tf.zeros([1, 240, 4]).arraySync() as number[][][];
    const row = yTrue[0]?.[0] ?? [];
    const prow = yPred[0]?.[0] ?? [];
    row[4] = 1;
    prow[0] = 1; // → 2
    prow[1] = 1; // vx → 3
    prow[2] = 1; // vy → 3
    prow[3] = 50; // ignored
    const l = makeLoss(cfg)(tf.tensor3d(yTrue), tf.tensor3d(yPred));
    expect(l.dataSync()[0]).toBeCloseTo(8, 6);
  });

  it("batches carry velocity targets re-encoded from the stored ones", () => {
    const { train: path } = tinyFeatures(8);
    const f = openFeatures(path);
    try {
      const cfg = tinyConfig("instantaneous", VELOCITY);
      const b = makeBatch(f, [0], cfg, labelMap(cfg, f.count));
      const w = f.read(0);
      const want = new Float32Array(4);
      encodeTargets(w.targets, 50 * NT, f.norm, outputSpec(cfg), want, 0);
      for (let c = 0; c < 4; c++) expect(b.y[50 * NY + c]).toBeCloseTo(want[c] ?? NaN, 6);
    } finally {
      f.close();
    }
  });

  it("a velocity model trains and predicts end to end", async () => {
    const data = tinyFeatures(24);
    const out = tempDir();
    const cfg = tinyConfig("instantaneous", { ...VELOCITY, max_epochs: 1 });
    const m = await train({
      config: cfg,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: () => undefined,
      source: { commit: "c".repeat(40), dirty: false },
    });
    expect(m.config.output_parameterisation).toBe("velocity");
    const model = await loadModel(out);
    const f = openFeatures(data.val);
    try {
      const ss = Array.from(
        { length: 4 },
        (_, i) => generateScenario(3n, 10_000 + i, DEFAULT_RANGES).scenario,
      );
      const ps = predictScenarios(model, f, ss, f.norm, m.id, outputSpec(m.config));
      expect(ps).toHaveLength(4);
      for (const p of ps) for (const r of p.rows) expect(Number.isFinite(r.speed_mps)).toBe(true);
    } finally {
      f.close();
      model.dispose();
    }
  });
});
