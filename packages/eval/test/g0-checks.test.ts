// G0 independent geometry with the rate-limited turn (spec 003 US6, T016).
import { DEFAULT_RANGES, degToRad, noiseFree } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  checkBearingResiduals,
  checkIndependentGeometry,
  inTurnBearing,
} from "../src/g0-checks.js";
import { scenarios } from "./helpers.js";

const TURN: ParameterRanges = noiseFree({
  ...DEFAULT_RANGES,
  ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
});

describe("G0 independent geometry: in-turn case", () => {
  it("the half-way-through-the-turn bearing matches the hand-computed arc", () => {
    const { got, want } = inTurnBearing();
    // r = 10 / (π/180) = 572.958 m; ownship at (76.762, 3286.479); bearing 123.725°.
    expect((want * 180) / Math.PI).toBeCloseTo(123.72486, 4);
    expect((got * 180) / Math.PI).toBeCloseTo(123.72486, 4);
  });

  it("passes on noise-free scenarios with a turn and names the in-turn case", () => {
    const c = checkIndependentGeometry(scenarios(5n, 200, TURN));
    expect(c.result).toBe("pass");
    expect(c.detail).toContain("in-turn");
  });

  it("final solutions on turn scenarios fit the bearings to float32 precision", () => {
    expect(checkBearingResiduals(scenarios(6n, 50, TURN)).result).toBe("pass");
  });
});
