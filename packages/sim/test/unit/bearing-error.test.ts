// Generator 0.6.0 (SRD Annex C §C.14, spec 019): realistic bearing error. The geometry and white
// noise are 0.5.0's for the same seed; the added error is exactly `bearingErrors`; and its two
// Gauss–Markov terms have the declared stationary sd and lag correlation exp(−lag/τ).
import { readFileSync } from "node:fs";
import type { BearingErrorModel, ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff } from "../../src/geometry.js";
import { deriveSeed } from "../../src/prng.js";
import { bearingErrors, generateScenario } from "../../src/scenario.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const DEG = Math.PI / 180;
const MODEL: BearingErrorModel = {
  ar_sd_rad: 0.5 * DEG,
  ar_tau_s: 30,
  bias_sd_rad: 0.3 * DEG,
  bias_tau_s: 1200,
};

describe("realistic bearing error (generator 0.6.0)", () => {
  it("keeps 0.5.0's geometry and white noise, and adds exactly bearingErrors", () => {
    for (let i = 0; i < 20; i++) {
      const clean = generateScenario(7n, i, PHASE4).scenario;
      const err = generateScenario(7n, i, { ...PHASE4, bearing_error: MODEL }).scenario;
      expect(err.target).toEqual(clean.target);
      expect(err.ownship).toEqual(clean.ownship);
      const { bearing_error: recorded, ...rest } = err.metadata.parameters;
      expect(rest).toEqual(clean.metadata.parameters);
      expect(recorded).toEqual({
        ar_sd_rad: Math.fround(MODEL.ar_sd_rad),
        ar_tau_s: 30,
        bias_sd_rad: Math.fround(MODEL.bias_sd_rad),
        bias_tau_s: 1200,
      });
      const e = bearingErrors(
        deriveSeed(7n, i),
        MODEL,
        clean.metadata.parameters.dt_s,
        clean.metadata.samples,
      );
      err.observations.forEach((o, k) => {
        const c = clean.observations[k];
        expect(o.valid).toBe(c?.valid);
        if (!o.valid) return;
        // float32 storage: within a few ulps of the angle.
        expect(Math.abs(angleDiff(o.bearing_rad, c?.bearing_rad ?? 0) - (e[k] ?? 0))).toBeLessThan(
          2e-6,
        );
      });
    }
  });

  it("has the declared stationary sds and correlations", () => {
    const dt = 10;
    const n = 20000;
    const fast = { ...MODEL, bias_sd_rad: 1e-12 };
    const slow = { ...MODEL, ar_sd_rad: 1e-12 };
    const stats = (m: BearingErrorModel, lag: number) => {
      let s0 = 0;
      let s2 = 0;
      let c = 0;
      let first = 0;
      for (let j = 0; j < n; j++) {
        const x = bearingErrors(BigInt(1000 + j), m, dt, 1 + lag);
        const a = x[0] ?? 0;
        const b = x[lag] ?? 0;
        s0 += a;
        s2 += a * a;
        c += a * b;
        first += a;
      }
      const sd = Math.sqrt(s2 / n - (s0 / n) ** 2);
      return { sd, rho: c / n / (s2 / n), mean: first / n };
    };
    // The correlated term: sd 0.5°, correlation over 30 s exp(−1).
    const f = stats(fast, 3);
    expect(f.sd / MODEL.ar_sd_rad).toBeGreaterThan(0.97);
    expect(f.sd / MODEL.ar_sd_rad).toBeLessThan(1.03);
    expect(Math.abs(f.rho - Math.exp(-1))).toBeLessThan(0.03);
    // The bias: sd 0.3°, correlation over 20 min exp(−1).
    const b = stats(slow, 120);
    expect(b.sd / MODEL.bias_sd_rad).toBeGreaterThan(0.97);
    expect(b.sd / MODEL.bias_sd_rad).toBeLessThan(1.03);
    expect(Math.abs(b.rho - Math.exp(-1))).toBeLessThan(0.03);
  });
});
