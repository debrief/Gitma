// Spec 009: the disagreement-switch hybrid (hybrid.ts).
import type { Prediction, PredictionRow } from "@tma/types";
import { describe, expect, it } from "vitest";
import { hybridName, hybridSwitch, SWITCH_RANGE_REL, useNetwork } from "../src/hybrid.js";

const row = (t: number, range: number, converged = true): PredictionRow => ({
  timestamp_s: t,
  range_m: range,
  course_rad: 1,
  speed_mps: 5,
  x_m: range,
  y_m: 0,
  converged,
});
const pred = (estimator: string, rows: PredictionRow[], index = 7): Prediction => ({
  record: "prediction",
  scenario_index: index,
  estimator,
  mode: "per_timestep",
  rows,
});

describe("hybrid switch", () => {
  it("keeps classical unless it failed or disagrees on range by more than 50%", () => {
    expect(SWITCH_RANGE_REL).toBe(0.5);
    expect(useNetwork(row(0, 10_000), row(0, 8_000))).toBe(false);
    expect(useNetwork(row(0, 12_000), row(0, 8_000))).toBe(false); // exactly 50%: kept
    expect(useNetwork(row(0, 12_001), row(0, 8_000))).toBe(true);
    expect(useNetwork(row(0, 3_999), row(0, 8_000))).toBe(true);
    expect(useNetwork(row(0, 10_000, false), row(0, 10_000))).toBe(true);
    expect(useNetwork(row(0, 10_000), row(0, 0))).toBe(false);
  });

  it("takes the network's row where it switches, classical's otherwise", () => {
    const c = pred("classical", [row(10, 10_000), row(20, 40_000), row(30, 9_000, false)]);
    const n = pred("lstm-instantaneous", [row(10, 9_000), row(20, 10_000), row(30, 9_500)]);
    const h = hybridSwitch(c, n);
    expect(h.estimator).toBe(hybridName("lstm-instantaneous"));
    expect(h.estimator).toBe("hybrid-lstm-instantaneous");
    expect(h.rows).toEqual([c.rows[0], n.rows[1], n.rows[2]]);
  });

  it("refuses predictions that do not line up", () => {
    const c = pred("classical", [row(10, 10_000)]);
    expect(() => hybridSwitch(c, pred("n", [row(10, 1)], 8))).toThrow(/scenario 8/);
    expect(() => hybridSwitch(c, pred("n", [row(10, 1), row(20, 1)]))).toThrow(/rows/);
    expect(() => hybridSwitch(c, pred("n", [row(11, 1)]))).toThrow(/times differ/);
    expect(() => hybridSwitch(c, { ...pred("n", [row(10, 1)]), mode: "final" })).toThrow(
      /per-timestep/,
    );
  });
});
