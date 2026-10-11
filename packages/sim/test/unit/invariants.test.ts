import type { Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, TWO_PI } from "../../src/geometry.js";
import { DEFAULT_RANGES, noiseFree } from "../../src/ranges.js";
import { generateScenario } from "../../src/scenario.js";

const N = 1000;
const scenarios: Scenario[] = Array.from(
  { length: N },
  (_, i) => generateScenario(99n, i, DEFAULT_RANGES).scenario,
);

function allNumbers(x: unknown, out: number[] = []): number[] {
  if (typeof x === "number") out.push(x);
  else if (Array.isArray(x)) for (const v of x) allNumbers(v, out);
  else if (x !== null && typeof x === "object")
    for (const v of Object.values(x)) allNumbers(v, out);
  return out;
}

describe("scenario invariants over 1,000 seeds", () => {
  it("windows are 60–240 samples with the zig at 40–60%", () => {
    for (const s of scenarios) {
      const m = s.metadata;
      expect(m.samples).toBeGreaterThanOrEqual(60);
      expect(m.samples).toBeLessThanOrEqual(240);
      expect(s.observations).toHaveLength(m.samples);
      expect(s.ownship.states).toHaveLength(m.samples);
      expect(m.zig_index).toBeGreaterThanOrEqual(Math.floor(0.4 * m.samples));
      expect(m.zig_index).toBeLessThanOrEqual(Math.ceil(0.6 * m.samples));
    }
  });

  it("every stored number is float32 and every angle is in [0, 2π)", () => {
    for (const s of scenarios.slice(0, 100)) {
      expect(allNumbers(s).filter((v) => Math.fround(v) !== v)).toEqual([]);
      for (const o of s.observations) {
        expect(o.bearing_rad).toBeGreaterThanOrEqual(0);
        expect(o.bearing_rad).toBeLessThan(TWO_PI);
      }
    }
  });

  it("target moves at constant velocity", () => {
    for (const s of scenarios.slice(0, 100)) {
      const st = s.target.states;
      const first = st[0];
      const second = st[1];
      if (first === undefined || second === undefined) throw new Error("empty track");
      const vx = (second.x_m - first.x_m) / 10;
      const vy = (second.y_m - first.y_m) / 10;
      const last = st[st.length - 1];
      if (last === undefined) throw new Error("empty track");
      const t = last.timestamp_s;
      // Allow float32 rounding of positions up to ~30 km.
      expect(Math.abs(first.x_m + vx * t - last.x_m)).toBeLessThan(1);
      expect(Math.abs(first.y_m + vy * t - last.y_m)).toBeLessThan(1);
    }
  });

  it("no geometry comes within the minimum range", () => {
    for (const s of scenarios) expect(s.metadata.min_range_m).toBeGreaterThanOrEqual(100);
  });

  it("dropouts occur at the drawn rate in aggregate", () => {
    let expected = 0;
    let dropped = 0;
    for (const s of scenarios) {
      expected += s.metadata.parameters.dropout_fraction * s.metadata.samples;
      dropped += s.observations.filter((o) => !o.valid).length;
    }
    expect(Math.abs(dropped - expected) / expected).toBeLessThan(0.05);
  });

  it("is deterministic per (seed, index) and differs across indices", () => {
    expect(generateScenario(99n, 5, DEFAULT_RANGES).scenario).toEqual(scenarios[5]);
    expect(scenarios[5]?.metadata.seed).not.toBe(scenarios[6]?.metadata.seed);
  });

  it("t = 0 geometry matches the drawn initial bearing and range (frame check, T079)", () => {
    // G0 cannot see a frame error confined to the generator (the solver fits whatever the stored
    // bearings say), so tie the stored truth back to the drawn parameters directly.
    for (let i = 0; i < 1000; i++) {
      const s = generateScenario(77n, i, noiseFree(DEFAULT_RANGES)).scenario;
      const p = s.metadata.parameters;
      const o = s.ownship.states[0];
      const t = s.target.states[0];
      const z = s.observations[0];
      if (o === undefined || t === undefined || z === undefined) throw new Error();
      expect(Math.abs(angleDiff(z.bearing_rad, p.target_bearing0_rad))).toBeLessThan(1e-6);
      expect(Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m) / p.target_range0_m).toBeCloseTo(1, 6);
    }
  });

  it("noise-free scenarios have σ = 0 and no dropouts", () => {
    const s = generateScenario(1n, 0, noiseFree(DEFAULT_RANGES)).scenario;
    expect(s.metadata.parameters.noise_sigma_rad).toBe(0);
    expect(s.observations.every((o) => o.valid)).toBe(true);
  });
});
