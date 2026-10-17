// G0 independent geometry with the rate-limited turn (spec 003 US6, T016).
import { DEFAULT_RANGES, degToRad, noiseFree } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  checkBearingResiduals,
  checkIndependentGeometry,
  inTurnBearings,
} from "../src/g0-checks.js";
import { scenarios } from "./helpers.js";

const TURN: ParameterRanges = noiseFree({
  ...DEFAULT_RANGES,
  ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
});

describe("G0 independent geometry: in-turn case", () => {
  it("starboard and port turn bearings match the hand-computed arc and leg 2", () => {
    // r = 10 / (π/180) = 572.958 m. Mid-turn ownship at (±76.762, 3286.479); leg 2 at t = 400 s.
    const want: Record<string, number> = {
      "starboard mid-turn": 123.72486,
      "starboard leg 2": 130.24361,
      "port mid-turn": 122.9173,
      "port leg 2": 123.27213,
    };
    const cases = inTurnBearings();
    expect(cases.map((c) => c.name)).toEqual(Object.keys(want));
    for (const c of cases) {
      const deg = (a: number): number => ((((a * 180) / Math.PI) % 360) + 360) % 360;
      expect(deg(c.want)).toBeCloseTo(want[c.name] ?? NaN, 4);
      expect(deg(c.got)).toBeCloseTo(want[c.name] ?? NaN, 4);
    }
  });

  it("passes on noise-free scenarios with a turn and names the turn cases", () => {
    const c = checkIndependentGeometry(scenarios(5n, 200, TURN));
    expect(c.result).toBe("pass");
    expect(c.detail).toContain("starboard and port");
  });

  it("final solutions on turn scenarios fit the bearings to float32 precision", () => {
    expect(checkBearingResiduals(scenarios(6n, 50, TURN)).result).toBe("pass");
  });
});

const ACROSS: ParameterRanges = {
  ...TURN,
  zig_rule: "across_los",
  los_offset_rad: { min: degToRad(30), max: degToRad(90) },
  zig2_delay_s: { min: 180, max: 300 },
};

describe("G0 independent geometry: generator 0.3.0 (spec 007)", () => {
  it("passes on across-LOS two-zig scenarios and counts both turns", () => {
    const c = checkIndependentGeometry(scenarios(8n, 100, ACROSS), ACROSS);
    expect(c.result).toBe("pass");
    expect(c.detail).toContain("leg-3");
    expect(c.detail).toContain("200 turns put the target on the other bow");
  });

  it("fails when random-rule scenarios are claimed to be across the line of sight", () => {
    const random: ParameterRanges = { ...TURN, zig2_delay_s: { min: 180, max: 300 } };
    const c = checkIndependentGeometry(scenarios(8n, 100, random), {
      ...random,
      zig_rule: "across_los",
      los_offset_rad: { min: degToRad(30), max: degToRad(90) },
    });
    expect(c.result).toBe("fail");
    expect(c.detail).toMatch(/not across the line of sight/);
  });
});
