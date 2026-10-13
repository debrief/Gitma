// Scenario invariants with the rate-limited turn (spec 003 US6, T015).
import { readFileSync } from "node:fs";
import type { ParameterRanges, ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, degToRad, wrap2pi } from "../../src/geometry.js";
import { createRng } from "../../src/prng.js";
import { DEFAULT_RANGES, noiseFree } from "../../src/ranges.js";
import { drawParameters, generateScenario, simulateTruth } from "../../src/scenario.js";

const TURN: ParameterRanges = {
  ...DEFAULT_RANGES,
  ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
};

/** Generator 0.1.0's ownship motion, copied verbatim as the reference for the no-turn path. */
function ownship010(p: ScenarioParameters): { x: number[]; y: number[]; c: number[] } {
  const samples = Math.round(p.window_s / p.dt_s);
  const zigIndex = Math.round(p.zig_fraction * samples);
  const tZig = zigIndex * p.dt_s;
  const c0 = p.ownship_course0_rad;
  const c1 = wrap2pi(c0 + p.zig_angle_rad);
  const v = p.ownship_speed_mps;
  const zx = v * Math.sin(c0) * tZig;
  const zy = v * Math.cos(c0) * tZig;
  const out = { x: [] as number[], y: [] as number[], c: [] as number[] };
  for (let i = 0; i < samples; i++) {
    const t = i * p.dt_s;
    if (i < zigIndex) {
      out.x.push(v * Math.sin(c0) * t);
      out.y.push(v * Math.cos(c0) * t);
      out.c.push(c0);
    } else {
      out.x.push(zx + v * Math.sin(c1) * (t - tZig));
      out.y.push(zy + v * Math.cos(c1) * (t - tZig));
      out.c.push(c1);
    }
  }
  return out;
}

describe("scenarios with a rate-limited turn", () => {
  const scenarios = Array.from({ length: 500 }, (_, i) => generateScenario(55n, i, TURN).scenario);

  it("draw a turn rate in range and record turn_start_index ≤ zig_index < samples", () => {
    for (const s of scenarios) {
      const m = s.metadata;
      const w = m.parameters.ownship_turn_rate_rad_s ?? NaN;
      expect(w).toBeGreaterThanOrEqual(Math.fround(degToRad(0.5)));
      expect(w).toBeLessThanOrEqual(Math.fround(degToRad(3)));
      expect(m.turn_start_index).toBeDefined();
      expect(m.turn_start_index ?? Infinity).toBeLessThanOrEqual(m.zig_index);
      expect(m.zig_index).toBeLessThan(m.samples);
      expect(m.zig_time_s).toBe(m.zig_index * 10);
    }
  });

  it("zig_index is the first sample after the turn completes", () => {
    for (const s of scenarios) {
      const m = s.metadata;
      const p = m.parameters;
      const start = (m.turn_start_index ?? NaN) - 1; // the turn starts at this sample's time
      expect(start).toBe(Math.round(p.zig_fraction * m.samples));
      const turnS = Math.abs(p.zig_angle_rad) / (p.ownship_turn_rate_rad_s ?? NaN);
      expect((m.zig_index - start) * 10).toBeGreaterThanOrEqual(turnS);
      expect((m.zig_index - 1 - start) * 10).toBeLessThan(turnS);
      const c1 = wrap2pi(p.ownship_course0_rad + p.zig_angle_rad);
      const states = s.ownship.states;
      // On course c0 up to the turn start, on c1 from zig_index on, part-turned in between.
      const c0Err = angleDiff(states[start]?.course_rad ?? NaN, p.ownship_course0_rad);
      expect(Math.abs(c0Err)).toBeLessThan(1e-6);
      expect(Math.abs(angleDiff(states[m.zig_index]?.course_rad ?? NaN, c1))).toBeLessThan(1e-6);
      for (let i = start + 1; i < m.zig_index; i++) {
        const turned = angleDiff(states[i]?.course_rad ?? NaN, p.ownship_course0_rad);
        expect(Math.sign(turned)).toBe(Math.sign(p.zig_angle_rad));
        expect(Math.abs(turned)).toBeLessThan(Math.abs(p.zig_angle_rad));
      }
    }
  });

  it("t = 0 bearing and range equal the drawn parameters", () => {
    for (let i = 0; i < 500; i++) {
      const s = generateScenario(78n, i, noiseFree(TURN)).scenario;
      const p = s.metadata.parameters;
      const o = s.ownship.states[0];
      const t = s.target.states[0];
      const z = s.observations[0];
      if (o === undefined || t === undefined || z === undefined) throw new Error();
      expect(Math.abs(angleDiff(z.bearing_rad, p.target_bearing0_rad))).toBeLessThan(1e-6);
      expect(Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m) / p.target_range0_m).toBeCloseTo(1, 6);
    }
  });

  it("every stored number is float32", () => {
    const nums: number[] = [];
    const walk = (x: unknown): void => {
      if (typeof x === "number") nums.push(x);
      else if (x !== null && typeof x === "object") for (const v of Object.values(x)) walk(v);
    };
    for (const s of scenarios.slice(0, 50)) walk(s);
    expect(nums.filter((v) => Math.fround(v) !== v)).toEqual([]);
  });
});

describe("absent turn rate reproduces generator 0.1.0", () => {
  it("ownship trajectories equal the 0.1.0 formula exactly, over 1,000 drawn parameter sets", () => {
    const s = createRng(123n);
    for (let i = 0; i < 1000; i++) {
      const p = drawParameters(s, DEFAULT_RANGES);
      expect(p).not.toHaveProperty("ownship_turn_rate_rad_s");
      const tr = simulateTruth(p);
      const ref = ownship010(p);
      expect(tr.turnStartIndex).toBeNull();
      expect(Array.from(tr.ownX)).toEqual(ref.x);
      expect(Array.from(tr.ownY)).toEqual(ref.y);
      expect(Array.from(tr.ownCourse)).toEqual(ref.c);
    }
  });

  it("scenarios are byte-identical to the 0.1.0 golden (no turn_start_index, no turn rate)", () => {
    const golden = readFileSync(new URL("../golden/seed1-3.ndjson", import.meta.url), "utf8");
    const text = [0, 1, 2]
      .map((i) => JSON.stringify(generateScenario(1n, i, DEFAULT_RANGES).scenario))
      .join("\n")
      .concat("\n");
    expect(text === golden).toBe(true);
    expect(golden).not.toContain("turn");
  });
});
