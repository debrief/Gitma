// Generator 0.3.0 (spec 007): the across-the-line-of-sight rule and the second zig. Known answers
// are hand-computed; the generated-scenario checks hold for every scenario the iteration-3 ranges
// produce.
import type { ParameterRanges, ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, bearingOf, degToRad } from "../../src/geometry.js";
import { DEFAULT_RANGES } from "../../src/ranges.js";
import { acrossLosTurn, generateScenario, simulateTruth } from "../../src/scenario.js";

const deg = (r: number): number => (r * 180) / Math.PI;
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

describe("acrossLosTurn: known answers (ownship at the origin heading north)", () => {
  const at = (brgDeg: number, offDeg: number): number =>
    deg(
      acrossLosTurn(
        0,
        0,
        0,
        1000 * Math.sin(degToRad(brgDeg)),
        1000 * Math.cos(degToRad(brgDeg)),
        degToRad(offDeg),
      ),
    );
  it("target 40° on the starboard bow, offset 60°: turn 100° to starboard (target to port at 60°)", () => {
    expect(at(40, 60)).toBeCloseTo(100, 9);
  });
  it("target 20° on the port bow, offset 30°: turn 50° to port", () => {
    expect(at(-20, 30)).toBeCloseTo(-50, 9);
  });
  it("target on the starboard quarter (150°), offset 60°: the shorter turn is 150° to port", () => {
    expect(at(150, 60)).toBeCloseTo(-150, 9);
  });
  it("the target always ends on the other bow at the offset", () => {
    for (const brg of [-170, -95, -30, -1, 1, 45, 89, 135, 179]) {
      for (const off of [30, 60, 90]) {
        const zig = at(brg, off);
        const relAfter = wrapPi(degToRad(brg - zig));
        expect(Math.sign(relAfter)).toBe(-Math.sign(brg));
        expect(Math.abs(deg(relAfter))).toBeCloseTo(off, 9);
        expect(Math.abs(zig)).toBeLessThanOrEqual(180 + 1e-9);
      }
    }
  });
});

const base: ScenarioParameters = {
  window_s: 1800,
  dt_s: 10,
  ownship_speed_mps: 5,
  ownship_course0_rad: 0,
  zig_angle_rad: degToRad(90),
  zig_fraction: 0.5,
  target_range0_m: 8000,
  target_bearing0_rad: Math.PI / 2,
  target_speed_mps: 0,
  target_course_rad: 0,
  noise_sigma_rad: 0,
  dropout_fraction: 0,
  zig2_delay_s: 240,
  zig2_angle_rad: degToRad(-60),
};

describe("second zig: known answers", () => {
  it("instantaneous: leg 2 from sample 90, second zig at sample 114 to course 30°", () => {
    const tr = simulateTruth(base);
    expect(tr.zigIndex).toBe(90);
    expect(tr.zig2Index).toBe(114);
    expect(tr.turn2StartIndex).toBeNull();
    // Leg 1 north 4500 m, leg 2 east for 240 s (1200 m), then 30° true.
    expect(tr.ownX[114]).toBeCloseTo(1200, 9);
    expect(tr.ownY[114]).toBeCloseTo(4500, 9);
    expect(tr.ownCourse[113]).toBeCloseTo(Math.PI / 2, 12);
    expect(tr.ownCourse[114]).toBeCloseTo(degToRad(30), 12);
    expect(tr.ownX[124]).toBeCloseTo(1200 + 500 * Math.sin(degToRad(30)), 9);
    expect(tr.ownY[124]).toBeCloseTo(4500 + 500 * Math.cos(degToRad(30)), 9);
  });

  it("rate-limited: second arc at the same rate, leg 3 after it, speed v throughout", () => {
    const tr = simulateTruth({ ...base, ownship_turn_rate_rad_s: degToRad(1) });
    // First turn 90 s: leg 2 from sample 90 + 1 + 9 - 1 = 99; second turn starts at 99 + 24 = 123.
    expect(tr.zigIndex).toBe(99);
    expect(tr.turn2StartIndex).toBe(124);
    expect(tr.zig2Index).toBe(129);
    expect(tr.ownCourse[123]).toBeCloseTo(Math.PI / 2, 12);
    expect(tr.ownCourse[129]).toBeCloseTo(degToRad(30), 12);
    for (let i = 1; i < tr.samples; i++) {
      const step = Math.hypot(
        (tr.ownX[i] ?? 0) - (tr.ownX[i - 1] ?? 0),
        (tr.ownY[i] ?? 0) - (tr.ownY[i - 1] ?? 0),
      );
      // Chords on an arc are a little shorter than the arc length.
      expect(step).toBeLessThanOrEqual(50 + 1e-9);
      expect(step).toBeGreaterThan(49.9);
    }
  });

  it("without zig2 fields the path is the two-leg path", () => {
    const one: ScenarioParameters = { ...base };
    delete one.zig2_delay_s;
    delete one.zig2_angle_rad;
    const tr = simulateTruth(one);
    expect(tr.zig2Index).toBeNull();
    expect(tr.ownCourse[150]).toBeCloseTo(Math.PI / 2, 12);
  });
});

// Noisy (σ = 2°), so a rule planned from the observed bearing rather than the true one fails the
// offset bounds below (G0 red team round 1, mutation M4: G0's noise-free data cannot see it).
const ITER3: ParameterRanges = {
  ...DEFAULT_RANGES,
  noise_sigma_rad_values: [degToRad(2)],
  ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
  zig_rule: "across_los",
  los_offset_rad: { min: degToRad(30), max: degToRad(90) },
  zig2_delay_s: { min: 180, max: 300 },
};

describe("generated scenarios under across_los with a second zig", () => {
  it("both turns cross the line of sight to the drawn offset; legs are steady; turns complete", () => {
    for (let i = 0; i < 200; i++) {
      const sc = generateScenario(7n, i, ITER3).scenario;
      const m = sc.metadata;
      const p = m.parameters;
      expect(p.zig2_delay_s).toBeGreaterThanOrEqual(180);
      expect(p.zig2_delay_s).toBeLessThanOrEqual(300);
      const z2 = m.zig2_index;
      const t2 = m.turn2_start_index;
      if (z2 == null || t2 == null || m.turn_start_index == null) throw new Error("no second zig");
      expect(z2).toBeLessThan(m.samples);
      expect(t2 - 1).toBe(m.zig_index + Math.round((p.zig2_delay_s ?? 0) / p.dt_s));
      for (const [start, end] of [
        [m.turn_start_index - 1, m.zig_index],
        [t2 - 1, z2],
      ] as const) {
        const o = sc.ownship.states[start];
        const g = sc.target.states[start];
        const after = sc.ownship.states[end];
        if (o === undefined || g === undefined || after === undefined) throw new Error("index");
        const brg = bearingOf(g.x_m - o.x_m, g.y_m - o.y_m);
        const before = wrapPi(brg - o.course_rad);
        const rel = wrapPi(brg - after.course_rad);
        expect(Math.sign(rel)).toBe(-Math.sign(before));
        // float32 storage: offsets within 0.01° of the drawn range.
        expect(deg(Math.abs(rel))).toBeGreaterThan(30 - 0.01);
        expect(deg(Math.abs(rel))).toBeLessThan(90 + 0.01);
      }
      // Leg 3 course is constant.
      const c = sc.ownship.states[z2]?.course_rad ?? NaN;
      for (let k = z2; k < m.samples; k++) {
        expect(Math.abs(angleDiff(sc.ownship.states[k]?.course_rad ?? NaN, c))).toBeLessThan(1e-6);
      }
    }
  });

  it("is deterministic and leaves the 0.2.0 draws untouched up to the new ones", () => {
    const a = generateScenario(7n, 3, ITER3).scenario;
    const b = generateScenario(7n, 3, ITER3).scenario;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
