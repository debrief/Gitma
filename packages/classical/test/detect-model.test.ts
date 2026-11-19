// Spec 030: a trained detector network's probability as the detector's score.
import type { Prediction } from "@tma/types";
import { describe, expect, it } from "vitest";
import { modelDetect, modelDetectorName } from "../src/detect.js";
import { isModelDetectorName } from "../src/names.js";

describe("model detector (spec 030)", () => {
  it("scores each row with p_manoeuvre, 0 where none is stated", () => {
    const row = { range_m: 0, course_rad: 0, speed_mps: 0, x_m: 0, y_m: 0, converged: false };
    const p: Prediction = {
      record: "prediction",
      scenario_index: 7,
      estimator: "det-lstm",
      mode: "per_timestep",
      rows: [
        { ...row, timestamp_s: 10, p_manoeuvre: 0.25 },
        { ...row, timestamp_s: 20 },
      ],
    };
    const d = modelDetect(p);
    expect(d.detector).toBe("pman-det-lstm");
    expect(d.rows.map((r) => r.score)).toEqual([0.25, 0]);
    expect(modelDetectorName("x")).toBe("pman-x");
    expect(isModelDetectorName("pman-x", "x")).toBe(true);
    expect(isModelDetectorName("crate-x-w6", "x")).toBe(false);
    expect(() => modelDetect({ ...p, mode: "final" })).toThrow();
  });
});
