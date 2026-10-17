// G0 independent geometry with the rate-limited turn (spec 003 US6, T016).
import { DEFAULT_RANGES, degToRad, noiseFree, simulateTruth } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  checkBearingResiduals,
  checkIndependentGeometry,
  inTurnBearings,
  kinematicFailure,
  secondTurnBearings,
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

describe("G0 kinematic consistency (red team round 1 mutations)", () => {
  const [base] = scenarios(9n, 1, ACROSS);
  if (base === undefined) throw new Error("no scenario");
  const z2 = base.metadata.zig2_index ?? NaN;
  const t2 = base.metadata.turn2_start_index ?? NaN;

  it("passes the generated three-leg scenario and the hand-computed second turns", () => {
    expect(kinematicFailure(base)).toBeNull();
    for (const c of secondTurnBearings())
      expect(Math.abs(c.got - c.want), c.name).toBeLessThan(1e-6);
  });

  it("catches leg 3 left on the leg-2 track while its course is written (M5b)", () => {
    const s = structuredClone(base);
    const own = s.ownship.states;
    const a = own[t2 - 2];
    const b = own[t2 - 1];
    if (a === undefined || b === undefined) throw new Error("index");
    for (let i = t2; i < own.length; i++) {
      const o = own[i];
      if (o === undefined) continue;
      const k = i - (t2 - 1);
      o.x_m = Math.fround(b.x_m + k * (b.x_m - a.x_m));
      o.y_m = Math.fround(b.y_m + k * (b.y_m - a.y_m));
    }
    expect(kinematicFailure(s)).toMatch(/chord heading/);
  });

  it("catches the second arc flown the wrong way with the courses unchanged (M1b)", () => {
    const p = {
      ...base.metadata.parameters,
      zig2_angle_rad: -(base.metadata.parameters.zig2_angle_rad ?? 0),
    };
    const wrong = simulateTruth(p);
    const s = structuredClone(base);
    for (let i = t2; i < z2 + 3 && i < s.ownship.states.length; i++) {
      const o = s.ownship.states[i];
      if (o === undefined) continue;
      o.x_m = Math.fround(wrong.ownX[i] ?? 0);
      o.y_m = Math.fround(wrong.ownY[i] ?? 0);
    }
    expect(kinematicFailure(s)).not.toBeNull();
  });

  it("catches leg 3 flown slower than the stored speed (red team round 2, M8)", () => {
    const s = structuredClone(base);
    const own = s.ownship.states;
    const start = own[z2];
    if (start === undefined) throw new Error("index");
    for (let i = z2 + 1; i < own.length; i++) {
      const o = own[i];
      if (o === undefined) continue;
      o.x_m = Math.fround(start.x_m + 0.98 * (o.x_m - start.x_m));
      o.y_m = Math.fround(start.y_m + 0.98 * (o.y_m - start.y_m));
    }
    expect(kinematicFailure(s)).toMatch(/slower than the stored speed/);
  });

  it("catches a turn whose stored angle disagrees with the turn flown (geometry round 2)", () => {
    const s = structuredClone(base);
    const zig = s.metadata.parameters.zig_angle_rad;
    // The same final course reached the other way round: stored angle replaced by 2π − |zig|.
    s.metadata.parameters.zig_angle_rad = zig - Math.sign(zig) * 2 * Math.PI;
    expect(kinematicFailure(s)).toMatch(/course changed .* stored/);
  });
});
