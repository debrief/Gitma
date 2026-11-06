// Spec 018: the IMM's stated standard deviations (opt-in, name suffix -sd). The delta method
// matches a seeded Monte Carlo on a small covariance; the estimates are unchanged; the default
// writes no sds (every frozen file stays byte-identical).
import { readFileSync } from "node:fs";
import { createRng, gaussian, generateScenario } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { type ImmParams, immName, immPredict, stateSds } from "../src/imm.js";
import { parseImmName } from "../src/names.js";

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
  guardedInit: 1,
};

describe("stated sds (spec 018)", () => {
  it("the delta method matches a seeded Monte Carlo for a tight covariance", () => {
    // Target 6 km north-east of ownship, 4 m/s heading 120°.
    const x = Float64Array.from([4000, 4500, 4 * Math.sin(2.094), 4 * Math.cos(2.094), 0]);
    const p = new Float64Array(25);
    const sd = [60, 40, 0.15, 0.1, 0.01];
    sd.forEach((v, i) => (p[6 * i] = v * v));
    p[1] = p[5] = 0.3 * 60 * 40; // correlated position
    const a = stateSds(x, p, 0, 0);
    expect(a).not.toBeNull();
    const rng = createRng(18n);
    const lr: number[] = [];
    const th: number[] = [];
    const sp: number[] = [];
    // Cholesky of the 2×2 position block, independent velocities.
    const l11 = 60;
    const l21 = 0.3 * 40;
    const l22 = Math.sqrt(40 * 40 - l21 * l21);
    for (let n = 0; n < 40000; n++) {
      const z1 = gaussian(rng);
      const z2 = gaussian(rng);
      const px = (x[0] ?? 0) + l11 * z1;
      const py = (x[1] ?? 0) + l21 * z1 + l22 * z2;
      const vx = (x[2] ?? 0) + 0.15 * gaussian(rng);
      const vy = (x[3] ?? 0) + 0.1 * gaussian(rng);
      lr.push(0.5 * Math.log(px * px + py * py));
      th.push(Math.atan2(vx, vy));
      sp.push(Math.hypot(vx, vy));
    }
    const sdOf = (v: number[]): number => {
      const m = v.reduce((t, y) => t + y, 0) / v.length;
      return Math.sqrt(v.reduce((t, y) => t + (y - m) ** 2, 0) / (v.length - 1));
    };
    expect(Math.abs((a?.log_range_sd ?? 0) / sdOf(lr) - 1)).toBeLessThan(0.02);
    expect(Math.abs((a?.course_sd_rad ?? 0) / sdOf(th) - 1)).toBeLessThan(0.02);
    expect(Math.abs((a?.speed_sd_mps ?? 0) / sdOf(sp) - 1)).toBeLessThan(0.02);
    // Undefined at zero range or zero speed.
    expect(stateSds(Float64Array.from([0, 0, 1, 1, 0]), p, 0, 0)).toBeNull();
    expect(stateSds(Float64Array.from([10, 10, 0, 0, 0]), p, 0, 0)).toBeNull();
  });

  it("is opt-in: -sd adds the sds and changes nothing else; the default writes none", () => {
    const sdRef = { ...REF, reportSd: true };
    expect(immName(sdRef)).toBe("imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd");
    expect(parseImmName(immName(sdRef))).toEqual(sdRef);
    expect(parseImmName("imm-cv0.01-ct0.03-w0.01-s0.001-sd-g1")).toBeNull();
    for (let i = 0; i < 6; i++) {
      const s = generateScenario(19n, i, PHASE4).scenario;
      const plain = immPredict(s, REF);
      const withSd = immPredict(s, sdRef);
      expect(plain.rows.every((r) => r.course_sd_rad === undefined)).toBe(true);
      expect(withSd.rows.length).toBe(plain.rows.length);
      withSd.rows.forEach((r, j) => {
        const { log_range_sd: a, course_sd_rad: b, speed_sd_mps: c, ...rest } = r;
        expect(rest).toEqual(plain.rows[j]);
        if (r.converged) {
          expect(a).toBeGreaterThan(0);
          expect(b).toBeGreaterThan(0);
          expect(c).toBeGreaterThan(0);
        }
      });
    }
  });
});
