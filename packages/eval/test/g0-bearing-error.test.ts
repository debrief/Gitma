// Generator 0.6.0 (spec 019): G0's bearing-error-model check, and that the tracker checks still see
// white noise only. A noise-free scenario carries no bearing error.
import { readFileSync } from "node:fs";
import { generateScenario, noiseFree } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  bearingErrorStats,
  bearingErrorStatsPass,
  checkBearingErrorModel,
  checkTrackerNis,
} from "../src/g0-checks.js";

const read = (f: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../configs/${f}`, import.meta.url), "utf8"),
  ) as ParameterRanges;
const P7 = read("phase7-ranges.json");
const P4 = read("phase4-ranges.json");

describe("G0 on generator 0.6.0 (spec 019)", () => {
  it("bearing-error-model passes on the phase-7 ranges and is not applicable without one", () => {
    expect(checkBearingErrorModel(P7).result).toBe("pass");
    const na = checkBearingErrorModel(P4);
    expect(na.result).toBe("pass");
    expect(na.detail).toMatch(/not applicable/);
  });

  it("bearing-error-model catches a constant bias and a 5-min one (it identifies τ_b)", () => {
    const m = P7.bearing_error;
    if (m == null) throw new Error("phase-7 ranges have no bearing_error");
    for (const tau of [1e12, 300]) {
      const x = bearingErrorStats({ ...P7, bearing_error: { ...m, bias_tau_s: tau } }, m, 5n, 400);
      expect(bearingErrorStatsPass(x)).toBe(false);
    }
  });

  it("noise-free data carries no bearing error: identical to 0.5.0's", () => {
    for (let i = 0; i < 5; i++) {
      const a = generateScenario(3n, i, noiseFree(P7)).scenario;
      const b = generateScenario(3n, i, noiseFree(P4)).scenario;
      expect(a).toEqual(b);
    }
  });

  it("the tracker NIS check sees white noise only, so it is unchanged", () => {
    expect(checkTrackerNis(P7).detail).toBe(checkTrackerNis(P4).detail);
  });
});
