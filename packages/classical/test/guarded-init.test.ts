// Spec 016: the guarded (re-)initialisation of the EKF and IMM, opt-in by name (-g1, -g2). The
// default (level 0) is every frozen reference and stays byte-identical (golden.test.ts).
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  ekfInitialise,
  ekfInitialiseGuarded,
  ekfName,
  ekfPredict,
  initialiseAt,
  MIN_FIT_RANGE_M,
} from "../src/ekf.js";
import { bearingData } from "../src/estimate.js";
import { type ImmParams, immName, immPredict } from "../src/imm.js";
import { parseEkfName, parseImmName } from "../src/names.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const REF: ImmParams = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
};

/** Cholesky test of an n×n row-major symmetric matrix. */
function positiveDefinite(p: Float64Array, n: number): boolean {
  const l = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let d = p[(n + 1) * j] ?? NaN;
    for (let k = 0; k < j; k++) d -= (l[n * j + k] ?? 0) ** 2;
    if (!(d > 0)) return false;
    l[(n + 1) * j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) {
      let v = p[n * i + j] ?? 0;
      for (let k = 0; k < j; k++) v -= (l[n * i + k] ?? 0) * (l[n * j + k] ?? 0);
      l[n * i + j] = v / (l[(n + 1) * j] ?? 1);
    }
  }
  return true;
}

// Seed 214 (the phase-4c test seed): 360417 is the panel's case (spec 015 R5); 362708 is one
// where the frozen IMM itself carries a non-positive-definite covariance after a step.
const scenario = (i: number): Scenario => generateScenario(214n, i, PHASE4).scenario;
const CASE = scenario(360417);
const PLAIN = scenario(362708);

describe("guarded initialisation (spec 016)", () => {
  it("is opt-in by name: level 0 keeps every frozen name, levels 1 and 2 add -g1 / -g2", () => {
    expect(immName(REF)).toBe("imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8");
    expect(immName({ ...REF, guardedInit: 0 })).toBe(immName(REF));
    expect(immName({ ...REF, guardedInit: 2 })).toBe("imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g2");
    expect(ekfName(0.03, { p0Scale: 4, rScale: 8, guardedInit: 1 })).toBe("ekf-sa0.03-p4-r8-g1");
    expect(parseImmName(immName({ ...REF, guardedInit: 1 }))).toEqual({ ...REF, guardedInit: 1 });
    expect(parseEkfName("ekf-sa0.03-g2")).toEqual({ sigmaA: 0.03, scales: { guardedInit: 2 } });
    expect(parseImmName("imm-cv0.01-ct0.03-w0.01-s0.001-g3")).toBeNull();
    expect(parseImmName("imm-cv0.01-ct0.03-w0.01-s0.001-g0")).toBeNull();
  });

  it("level 0 is the frozen initialiser, byte for byte", () => {
    for (const s of [CASE, PLAIN]) {
      expect(JSON.stringify(immPredict(s, { ...REF, guardedInit: 0 }))).toBe(
        JSON.stringify(immPredict(s, REF)),
      );
      const d = bearingData(s);
      const sigma = s.metadata.parameters.noise_sigma_rad;
      const i = s.metadata.zig_index;
      expect(initialiseAt(d, i, sigma, 4, 0, true)).toEqual(ekfInitialise(d, i, sigma, 4));
    }
  });

  it("on a healthy fit, the square-root covariance equals σ²(JᵀJ)⁻¹ to rounding", () => {
    for (const s of [CASE, PLAIN, scenario(360000), scenario(360001)]) {
      const d = bearingData(s);
      const sigma = s.metadata.parameters.noise_sigma_rad;
      const i = s.metadata.zig_index;
      const a = ekfInitialise(d, i, sigma, 4);
      const b = ekfInitialiseGuarded(d, i, sigma, 4);
      if (a === null) continue;
      expect(b).not.toBeNull();
      if (b === null) continue;
      expect(Array.from(b.x)).toEqual(Array.from(a.x));
      expect(positiveDefinite(b.p, 4)).toBe(true);
      for (let k = 0; k < 16; k++) {
        const scale = Math.sqrt(Math.abs((a.p[5 * (k >> 2)] ?? 0) * (a.p[5 * (k & 3)] ?? 0)));
        expect(Math.abs((b.p[k] ?? 0) - (a.p[k] ?? 0)) / scale).toBeLessThan(1e-8);
      }
    }
  });

  it("refuses the degenerate re-initialisation that the frozen one accepts (seed 214, 360417)", () => {
    const d = bearingData(CASE);
    const sigma = CASE.metadata.parameters.noise_sigma_rad;
    for (const i of [144, 148, 151, 154, 157]) {
      // The frozen initialiser: a fit through ownship at sample 0, covariance not PD.
      const a = ekfInitialise(d, i, sigma, 4);
      expect(a).not.toBeNull();
      expect(positiveDefinite(a?.p ?? new Float64Array(16), 4)).toBe(false);
      // Level 1 refuses it; level 2 re-initialises from the last 60 samples, PD.
      expect(ekfInitialiseGuarded(d, i, sigma, 4)).toBeNull();
      const w = initialiseAt(d, i, sigma, 4, 2, true);
      expect(w).not.toBeNull();
      expect(positiveDefinite(w?.p ?? new Float64Array(16), 4)).toBe(true);
      const [x = 0, y = 0] = w?.x ?? [];
      expect(Math.hypot(x - (d.ownX[i] ?? 0), y - (d.ownY[i] ?? 0))).toBeGreaterThan(
        MIN_FIT_RANGE_M,
      );
    }
  });

  it("keeps every IMM model covariance positive definite where the frozen IMM does not", () => {
    const steps = (g: 0 | 1 | 2): number => {
      let bad = 0;
      immPredict(PLAIN, { ...REF, guardedInit: g }, (_i, st) => {
        if (st.models.some((m) => !positiveDefinite(m.p, 5))) bad++;
      });
      return bad;
    };
    expect(steps(0)).toBeGreaterThan(0);
    expect(steps(1)).toBe(0);
    expect(steps(2)).toBe(0);
  });

  it("names the guarded EKF and IMM in their predictions, and refuses other levels", () => {
    expect(immPredict(CASE, { ...REF, guardedInit: 2 }).estimator).toMatch(/-g2$/);
    expect(ekfPredict(CASE, 0.03, { guardedInit: 1 }).estimator).toBe("ekf-sa0.03-g1");
    expect(() => ekfPredict(CASE, 0.03, { guardedInit: 3 as 1 })).toThrow(/0, 1 or 2/);
    expect(() => immPredict(CASE, { ...REF, guardedInit: 3 as 1 })).toThrow(/0, 1 or 2/);
  });
});
