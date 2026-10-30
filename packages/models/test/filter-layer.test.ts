// Spec 012 tracker T1: the learned-gain filter layer. With the EKF's own gains injected, its
// recursion reproduces the EKF (the known answer Annex C §C.9 asks for: prediction, wrapped
// innovation, update, dropouts and units all checked at once); the model builds, trains, saves,
// loads and predicts end to end.
import { readFileSync } from "node:fs";
import * as tf from "@tensorflow/tfjs-node";
import { bearingData, ekfInitialise, ekfPredictStep, ekfUpdate } from "@tma/classical";
import {
  buildWindow,
  computeNormalisation,
  inputWidth,
  openFeatures,
  outputSpec,
  rowsFor,
} from "@tma/features";
import { degToRad, generateScenario } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { ALLOWED_LAYERS, buildModel } from "../src/architectures.js";
import { LearnedGainFilter } from "../src/filter-layer.js";
import { loadModel, predictScenarios } from "../src/predict.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const VEL = { output_parameterisation: "velocity", velocity_scale_mps: 10.29 } as const;

describe("learned-gain filter: the recursion", () => {
  it("reproduces the EKF when given the EKF's gains", () => {
    const r = {
      ...PHASE4,
      noise_sigma_rad_values: [degToRad(1)],
      dropout_fraction: { min: 0.05, max: 0.05 },
    };
    const s = generateScenario(9n, 3, r).scenario;
    const m = s.metadata;
    const norm = computeNormalisation([s], "t");
    const L = norm.position_scale_km * 1000;
    const T = norm.time_scale_s;
    const w = buildWindow(s, norm, "raw", rowsFor(PHASE4));
    const d = bearingData(s);
    const sigma = m.parameters.noise_sigma_rad;
    const r2 = sigma * sigma;
    let ekf = ekfInitialise(d, m.zig_index, sigma);
    if (ekf === null) throw new Error("no initial EKF state");
    const layer = new LearnedGainFilter({ units: 4, seed: 1 });
    layer.build();
    let st = {
      p: tf.tensor2d([[(ekf.x[0] ?? 0) / L, (ekf.x[1] ?? 0) / L]]),
      v: tf.tensor2d([[((ekf.x[2] ?? 0) * T) / L, ((ekf.x[3] ?? 0) * T) / L]]),
      started: tf.tensor2d([[1]]),
      tPrev: tf.tensor2d([[(d.t[m.zig_index] ?? 0) / T]]),
      h: tf.zeros<tf.Rank.R2>([1, 4]),
    };
    let worst = 0;
    let updates = 0;
    for (let i = m.zig_index + 1; i < Math.min(m.samples, m.zig_index + 120); i++) {
      ekf = ekfPredictStep(ekf, d.t[i] ?? 0, 0.03);
      // The EKF's gain at this step: K = P hᵀ / (h P hᵀ + r²), h the bearing Jacobian.
      const [x = 0, y = 0] = ekf.x;
      const dx = x - (d.ownX[i] ?? 0);
      const dy = y - (d.ownY[i] ?? 0);
      const rho2 = dx * dx + dy * dy;
      const h = [dy / rho2, -dx / rho2, 0, 0];
      const ph = [0, 1, 2, 3].map((a) =>
        [0, 1, 2, 3].reduce((t, b) => t + (ekf?.p[4 * a + b] ?? 0) * (h[b] ?? 0), 0),
      );
      const sInn = r2 + h.reduce((t, hb, b) => t + hb * (ph[b] ?? 0), 0);
      const k = ph.map((v) => v / sInn);
      const gain = tf.tensor2d([
        [(k[0] ?? 0) / L, (k[1] ?? 0) / L, ((k[2] ?? 0) * T) / L, ((k[3] ?? 0) * T) / L],
      ]);
      if (d.valid[i] === 1) {
        ekf = ekfUpdate(ekf, d.bearing[i] ?? 0, d.ownX[i] ?? 0, d.ownY[i] ?? 0, r2);
        updates++;
      }
      const xi = tf.tensor2d(Array.from(w.inputs.subarray(i * 10, (i + 1) * 10)), [1, 10]);
      const out = layer.step(xi, st, gain);
      st = out.st;
      const p = st.p.dataSync();
      const err = Math.hypot((p[0] ?? 0) * L - (ekf.x[0] ?? 0), (p[1] ?? 0) * L - (ekf.x[1] ?? 0));
      const range = Math.hypot(dx, dy);
      worst = Math.max(worst, err / range);
    }
    expect(updates).toBeGreaterThan(50);
    // float32 inputs and tensors against the float64 EKF: agreement to 0.1% of range.
    expect(worst).toBeLessThan(1e-3);
  });
});

describe("learned-gain filter: the model", () => {
  it("is a declared filter layer and refuses other feature sets or outputs", () => {
    expect(ALLOWED_LAYERS.has("LearnedGainFilter")).toBe(true);
    expect(() => buildModel(tinyConfig("learned_gain_filter", { feature_set: "raw" }))).toThrow(
      /velocity/,
    );
    expect(() =>
      buildModel(
        tinyConfig("learned_gain_filter", { ...VEL, feature_set: "derived" }),
        inputWidth("derived"),
      ),
    ).toThrow(/raw/);
    const model = buildModel(tinyConfig("learned_gain_filter", { ...VEL, feature_set: "raw" }));
    expect(model.outputs[0]?.shape.at(-1)).toBe(4);
    model.dispose();
  });

  it("trains, saves, loads and predicts end to end", async () => {
    const data = tinyFeatures(16);
    const out = tempDir();
    const cfg = tinyConfig("learned_gain_filter", { ...VEL, feature_set: "raw", max_epochs: 1 });
    const t0 = Date.now();
    const trained = await train({
      config: cfg,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: () => undefined,
      source: { commit: "c".repeat(40), dirty: false },
    });
    const seconds = (Date.now() - t0) / 1000;
    expect(Number.isFinite(trained.best_val_loss ?? NaN)).toBe(true);
    expect(seconds).toBeLessThan(300);
    const model = await loadModel(out);
    const f = openFeatures(data.val);
    try {
      const ss = Array.from(
        { length: 2 },
        (_, i) =>
          generateScenario(3n, 10_000 + i, f.source?.header.parameter_ranges ?? PHASE4).scenario,
      );
      for (const p of predictScenarios(
        model,
        f,
        ss,
        f.norm,
        trained.id,
        outputSpec(trained.config),
      ))
        expect(p.rows.some((r) => r.converged && Number.isFinite(r.range_m))).toBe(true);
    } finally {
      f.close();
      model.dispose();
    }
  });
});
