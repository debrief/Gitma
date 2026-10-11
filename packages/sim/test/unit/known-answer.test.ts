// Hand-computed geometry, independent of the solver (plan: "G0 is necessary, not sufficient").
import type { ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, degToRad } from "../../src/geometry.js";
import { createRng } from "../../src/prng.js";
import { observe, simulateTruth } from "../../src/scenario.js";

const base: ScenarioParameters = {
  window_s: 600,
  dt_s: 10,
  ownship_speed_mps: 10,
  ownship_course0_rad: 0,
  zig_angle_rad: degToRad(60),
  zig_fraction: 0.5,
  target_range0_m: 1000,
  target_bearing0_rad: 0,
  target_speed_mps: 0,
  target_course_rad: 0,
  noise_sigma_rad: 0,
  dropout_fraction: 0,
};

const bearings = (p: ScenarioParameters): number[] =>
  observe(createRng(1n), p, simulateTruth(p)).map((o) => o.bearing_rad);

describe("known-answer geometry", () => {
  it("ownship east at 10 m/s, stationary target 1 km north: bearing 315° at t = 100 s", () => {
    const b = bearings({ ...base, ownship_course0_rad: degToRad(90) });
    // Ownship at (1000, 0), target at (0, 1000): atan2(-1000, 1000) = -45° = 315°.
    expect(b[10]).toBeCloseTo(degToRad(315), 6);
  });

  it("target dead ahead on a reciprocal course keeps constant bearing until the zig", () => {
    const p = { ...base, target_range0_m: 10000, target_speed_mps: 5, target_course_rad: Math.PI };
    const truth = simulateTruth(p);
    const b = bearings(p);
    for (let i = 0; i < truth.zigIndex; i++) {
      expect(Math.abs(angleDiff(b[i] ?? NaN, 0))).toBeLessThan(1e-6);
    }
    expect(Math.abs(angleDiff(b[truth.zigIndex + 5] ?? NaN, 0))).toBeGreaterThan(1e-3);
  });

  it("stationary target abeam to starboard draws aft (bearing increases clockwise)", () => {
    const p = { ...base, target_bearing0_rad: Math.PI / 2, target_range0_m: 5000 };
    const b = bearings(p);
    // Ownship heading north at (0, 10 t); target at (5000, 0): bearing = atan2(5000, -10 t).
    const t = 200;
    expect(b[20]).toBeCloseTo(Math.atan2(5000, -10 * t), 6);
    expect((b[20] ?? 0) - (b[0] ?? 0)).toBeGreaterThan(0);
  });

  it("the zig turns ownship by exactly the drawn angle with a continuous track", () => {
    const p = { ...base, ownship_course0_rad: degToRad(30), zig_angle_rad: degToRad(-75) };
    const tr = simulateTruth(p);
    const k = tr.zigIndex;
    expect(k).toBe(30);
    expect(tr.ownCourse[k - 1]).toBeCloseTo(degToRad(30), 12);
    expect(angleDiff(tr.ownCourse[k] ?? NaN, degToRad(315))).toBeCloseTo(0, 12);
    // Leg-2 displacement direction equals the new course; leg-1 end meets leg-2 start.
    const dx = (tr.ownX[k + 1] ?? 0) - (tr.ownX[k] ?? 0);
    const dy = (tr.ownY[k + 1] ?? 0) - (tr.ownY[k] ?? 0);
    expect(Math.hypot(dx, dy)).toBeCloseTo(100, 9);
    expect(angleDiff(Math.atan2(dx, dy), degToRad(315))).toBeCloseTo(0, 12);
    const legEndX = 10 * Math.sin(degToRad(30)) * 300;
    expect(tr.ownX[k]).toBeCloseTo(legEndX, 9);
  });
});
