// Known answers for the rate-limited turn (spec 003 US6, T014), hand-computed and independent of
// the arc helper's formula where possible.
import type { ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, degToRad } from "../../src/geometry.js";
import { arcPosition, simulateTruth } from "../../src/scenario.js";

const W = degToRad(1); // 1°/s
const V = 5;
const R = V / W; // 286.4789 m

const base: ScenarioParameters = {
  window_s: 600,
  dt_s: 10,
  ownship_speed_mps: V,
  ownship_course0_rad: 0,
  zig_angle_rad: degToRad(90),
  zig_fraction: 0.5,
  target_range0_m: 5000,
  target_bearing0_rad: Math.PI / 2,
  target_speed_mps: 0,
  target_course_rad: 0,
  noise_sigma_rad: 0,
  dropout_fraction: 0,
  ownship_turn_rate_rad_s: W,
};

describe("rate-limited turn: known answers", () => {
  it("90° at 1°/s and 5 m/s from (0, 0) heading north ends at (r, r) on course 90°, r = v/ω", () => {
    const end = arcPosition(0, 0, 0, V, W, 90);
    expect(end.x).toBeCloseTo(R, 9);
    expect(end.y).toBeCloseTo(R, 9);
    expect(end.course).toBeCloseTo(Math.PI / 2, 12);
  });

  it("a mid-turn sample lies on the arc: distance r from the centre (r, 0), heading 45°", () => {
    const mid = arcPosition(0, 0, 0, V, W, 45);
    expect(Math.hypot(mid.x - R, mid.y)).toBeCloseTo(R, 9);
    expect(mid.x).toBeCloseTo(R * (1 - Math.SQRT1_2), 9);
    expect(mid.y).toBeCloseTo(R * Math.SQRT1_2, 9);
    expect(mid.course).toBeCloseTo(Math.PI / 4, 12);
  });

  it("a negative zig mirrors the turn to port: (−r, r) on course 270°", () => {
    const end = arcPosition(0, 0, 0, V, -W, 90);
    expect(end.x).toBeCloseTo(-R, 9);
    expect(end.y).toBeCloseTo(R, 9);
    expect(angleDiff(end.course, degToRad(270))).toBeCloseTo(0, 12);
  });

  it("simulateTruth: turn from sample 30 (t = 300 s), arc, then leg 2 on the new course", () => {
    const tr = simulateTruth(base);
    // Turn starts at (0, 1500); 90° at 1°/s takes 90 s, so leg 2 starts at sample 39 (t = 390 s).
    expect(tr.turnStartIndex).toBe(31);
    expect(tr.zigIndex).toBe(39);
    expect(tr.ownCourse[30]).toBe(0);
    expect(tr.ownX[30]).toBeCloseTo(0, 9);
    expect(tr.ownY[30]).toBeCloseTo(1500, 9);
    // Sample 34 is 40 s into the turn: heading 40°, centre (r, 1500).
    const h = degToRad(40);
    expect(tr.ownX[34]).toBeCloseTo(R * (1 - Math.cos(h)), 6);
    expect(tr.ownY[34]).toBeCloseTo(1500 + R * Math.sin(h), 6);
    expect(tr.ownCourse[34]).toBeCloseTo(h, 9);
    // Sample 39 is 0 s after the arc ends at (r, 1500 + r) — the f32-free arc lasts exactly 90 s.
    expect(tr.ownCourse[39]).toBeCloseTo(Math.PI / 2, 12);
    expect(tr.ownX[39]).toBeCloseTo(R, 6);
    expect(tr.ownY[39]).toBeCloseTo(1500 + R, 6);
    // Leg 2 runs due east at 5 m/s.
    expect((tr.ownX[45] ?? 0) - (tr.ownX[39] ?? 0)).toBeCloseTo(300, 6);
    expect(tr.ownY[45]).toBeCloseTo(1500 + R, 6);
  });

  it("the track is continuous and moves at v throughout the turn", () => {
    const tr = simulateTruth({
      ...base,
      zig_angle_rad: degToRad(-75),
      ownship_turn_rate_rad_s: degToRad(0.5),
    });
    for (let i = 1; i < tr.samples; i++) {
      const step = Math.hypot(
        (tr.ownX[i] ?? 0) - (tr.ownX[i - 1] ?? 0),
        (tr.ownY[i] ?? 0) - (tr.ownY[i - 1] ?? 0),
      );
      // A chord of an arc is never longer than the 50 m travelled, and barely shorter here.
      expect(step).toBeLessThanOrEqual(50 + 1e-9);
      expect(step).toBeGreaterThan(49.9);
    }
    // 75° at 0.5°/s = 150 s: leg 2 from sample 45, course 285°.
    expect(tr.zigIndex).toBe(45);
    expect(angleDiff(tr.ownCourse[45] ?? NaN, degToRad(285))).toBeCloseTo(0, 9);
    expect(angleDiff(tr.ownCourse[44] ?? NaN, degToRad(285))).toBeGreaterThan(0);
  });

  it("a turn shorter than one sample interval leaves no in-turn sample", () => {
    const tr = simulateTruth({
      ...base,
      zig_angle_rad: degToRad(20),
      ownship_turn_rate_rad_s: degToRad(3),
    });
    // 20° at 3°/s = 6.67 s < 10 s.
    expect(tr.turnStartIndex).toBe(31);
    expect(tr.zigIndex).toBe(31);
  });

  it("a zero turn rate is the instantaneous zig", () => {
    const a = simulateTruth({ ...base, ownship_turn_rate_rad_s: 0 });
    const noTurn: ScenarioParameters = { ...base };
    Reflect.deleteProperty(noTurn, "ownship_turn_rate_rad_s");
    const b = simulateTruth(noTurn);
    expect(a).toEqual(b);
    expect(b.turnStartIndex).toBeNull();
    expect(b.zigIndex).toBe(30);
  });
});
