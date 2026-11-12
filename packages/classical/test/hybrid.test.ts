// Spec 009: the disagreement-switch hybrid (hybrid.ts).
import type { Prediction, PredictionRow } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  hybridName,
  hybridSwitch,
  SWITCH_RANGE_REL,
  TRACKER_SWITCH_COURSE_DEG,
  trackerHybrid,
  trackerHybridName,
  trackerHybridRow,
  useNetwork,
  useNetworkVelocity,
} from "../src/hybrid.js";

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

describe("tracker hybrid (spec 013)", () => {
  const r = (course: number, speed: number, range = 10_000, converged = true): PredictionRow => ({
    timestamp_s: 10,
    range_m: range,
    course_rad: course,
    speed_mps: speed,
    x_m: range,
    y_m: 0,
    converged,
  });
  const deg = Math.PI / 180;

  it("switches velocity only beyond the course threshold, wrapping across north", () => {
    expect(TRACKER_SWITCH_COURSE_DEG).toBe(45);
    expect(useNetworkVelocity(r(0, 5), r(44 * deg, 5))).toBe(false);
    expect(useNetworkVelocity(r(0, 5), r(46 * deg, 5))).toBe(true);
    expect(useNetworkVelocity(r(350 * deg, 5), r(20 * deg, 5))).toBe(false); // 30° apart
    expect(useNetworkVelocity(r(0, 5, 10_000, false), r(0, 5))).toBe(true);
    // At 180° (spec 022) a converged tracker's velocity is always kept, even exactly opposite.
    expect(useNetworkVelocity(r(0, 5), r(180 * deg, 5), 180)).toBe(false);
    expect(useNetworkVelocity(r(10 * deg, 5), r(190 * deg, 5), 180)).toBe(false);
    expect(useNetworkVelocity(r(0, 5, 10_000, false), r(0, 5), 180)).toBe(true);
  });

  it("takes the network's range always and the tracker's velocity when they agree", () => {
    const t = r(1, 4, 12_000);
    const n = { ...r(1.1, 6, 9_000), log_range_sd: 0.2, vx_sd_mps: 1, vy_sd_mps: 1 };
    const h = trackerHybridRow(t, n);
    expect(h.range_m).toBe(9_000);
    expect(h.log_range_sd).toBe(0.2);
    expect(h.course_rad).toBe(1);
    expect(h.speed_mps).toBe(4);
    expect(h.vx_sd_mps).toBeUndefined(); // the velocity is the tracker's, without an sd
    expect(trackerHybridRow(t, { ...n, course_rad: 2 })).toEqual({ ...n, course_rad: 2 });
    expect(trackerHybridRow(t, { ...n, converged: false })).toBe(t);
  });

  it("names the hybrid by both estimators and the threshold, and checks alignment", () => {
    const a = pred("imm-x", [r(0, 5)]);
    const b = pred("lstm-gaussian", [r(1, 5)]);
    expect(trackerHybrid(a, b).estimator).toBe("hybrid-lstm-gaussian-imm-x-c45");
    expect(trackerHybridName("n", "t", 30)).toBe("hybrid-n-t-c30");
    expect(() => trackerHybrid(a, pred("lstm-gaussian", [r(1, 5)], 8))).toThrow(/scenario 8/);
  });
});
