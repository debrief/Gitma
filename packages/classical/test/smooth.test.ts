// Spec 032 (SRD Annex J): the EKF's RTS smoother and the IMM's fixed-interval smoother.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { ekfPredict, ekfSmooth, ekfSmoothName } from "../src/ekf.js";
import { immPredict, immSmooth, immSmoothName } from "../src/imm.js";
import { invert, matmul } from "../src/matrix.js";
import { parseSmootherName } from "../src/names.js";
import { truthAt } from "./helpers.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
// White noise and no target manoeuvre: the smoother's model is right, so it must help.
const QUIET: ParameterRanges = {
  ...PHASE4,
  target_course_change_count_weights: [1, 0, 0, 0],
  target_speed_change_fraction: 0,
};
const scen: Scenario[] = Array.from(
  { length: 24 },
  (_, i) => generateScenario(11n, i, QUIET).scenario,
);
const SC = { p0Scale: 16, rScale: 4, guardedInit: 1 as const };
const IP = {
  sigmaCv: 0.003,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 16,
  rScale: 4,
  guardedInit: 1 as const,
};

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const midErrors = (s: Scenario, rows: PredictionRow[]): number[] =>
  rows
    .filter((r, j) => r.converged && j > rows.length * 0.25 && j < rows.length * 0.75)
    .map((r) => {
      const tr = truthAt(s, Math.round(r.timestamp_s / s.metadata.parameters.dt_s)).range;
      return Math.abs(r.range_m - tr) / tr;
    });

describe("smoothers (spec 032)", () => {
  it("matrix inverse round-trips", () => {
    const a = Float64Array.from([4, 1, 0, 1, 3, 1, 0, 1, 2]);
    const inv = invert(a, 3);
    expect(inv).not.toBeNull();
    const id = matmul(a, inv ?? new Float64Array(9), 3);
    id.forEach((v, k) => {
      expect(v).toBeCloseTo(k % 4 === 0 ? 1 : 0, 10);
    });
    expect(invert(new Float64Array(9), 3)).toBeNull();
  });

  it("the EKF smoother beats its forward filter mid-window and equals it at the last row", () => {
    const f: number[] = [];
    const sm: number[] = [];
    for (const s of scen) {
      const a = ekfPredict(s, 0.01, SC).rows;
      const b = ekfSmooth(s, 0.01, SC).rows;
      expect(b).toHaveLength(a.length);
      const la = a[a.length - 1];
      const lb = b[b.length - 1];
      if (la?.converged) expect(lb?.range_m).toBe(la.range_m);
      f.push(...midErrors(s, a));
      sm.push(...midErrors(s, b));
    }
    expect(median(sm)).toBeLessThan(0.8 * median(f));
    expect(ekfSmooth(scen[0] as Scenario, 0.01, SC).estimator).toBe(ekfSmoothName(0.01, SC));
    expect(ekfSmoothName(0.01, SC)).toBe("ekfs-sa0.01-p16-r4-g1");
  });

  it("the IMM smoother ends at its forward filter and, without switching, is the models' RTS", () => {
    // With switching the forward IMM's late estimate can drift (its turn model's ω picks up
    // curvature on a straight track), and the smoother inherits that end point by design.
    const noSwitch = { ...IP, switchPerS: 1e-12 };
    const f: number[] = [];
    const sm: number[] = [];
    for (const s of scen.slice(0, 12)) {
      const a = immPredict(s, IP).rows;
      const b = immSmooth(s, IP).rows;
      const la = a[a.length - 1];
      const lb = b[b.length - 1];
      if (la?.converged) expect(lb?.range_m).toBeCloseTo(la.range_m, 0);
      f.push(...midErrors(s, immPredict(s, noSwitch).rows));
      sm.push(...midErrors(s, immSmooth(s, noSwitch).rows));
    }
    expect(median(sm)).toBeLessThan(0.8 * median(f));
    expect(immSmoothName(IP)).toBe("imms-cv0.003-ct0.03-w0.01-s0.001-p16-r4-g1");
  });

  it("is deterministic", () => {
    const s = scen[2] as Scenario;
    expect(JSON.stringify(ekfSmooth(s, 0.01, SC))).toBe(JSON.stringify(ekfSmooth(s, 0.01, SC)));
    expect(JSON.stringify(immSmooth(s, IP))).toBe(JSON.stringify(immSmooth(s, IP)));
  });

  it("names round-trip (gate re-computation binds them)", () => {
    expect(parseSmootherName(ekfSmoothName(0.01, SC))).toEqual({
      kind: "ekf",
      sigmaA: 0.01,
      scales: SC,
    });
    expect(parseSmootherName(immSmoothName(IP))).toEqual({ kind: "imm", imm: IP });
    expect(parseSmootherName("ekf-sa0.01")).toBeNull();
    expect(parseSmootherName("ekfs-sa0.01-p16-r4-g3")).toBeNull();
  });
});
