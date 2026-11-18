// The EKF-fused tracker (spec 028; SRD Annex F): the EKF with a network's range fused in.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { type TrackerScales, ekfLogRangeSd, ekfPredict, ekfRangeUpdate } from "../src/ekf.js";
import { fadedSd, fusedEkfName, fusedEkfPredict, fusedName, fusedPredict } from "../src/fused.js";
import { parseFusedEkfName, parseFusedName } from "../src/names.js";
import { truthAt } from "./helpers.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const SA = 0.03;
const SC: TrackerScales = { p0Scale: 16, rScale: 64, guardedInit: 1 };

function network(s: Scenario, sd: number | undefined, converged = true): Prediction {
  const rows: PredictionRow[] = [];
  for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
    const t = s.target.states[i];
    rows.push({
      timestamp_s: s.ownship.states[i]?.timestamp_s ?? 0,
      range_m: truthAt(s, i).range,
      course_rad: t?.course_rad ?? 0,
      speed_mps: t?.speed_mps ?? 0,
      x_m: t?.x_m ?? 0,
      y_m: t?.y_m ?? 0,
      converged,
      ...(sd === undefined ? {} : { log_range_sd: sd }),
    });
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: "net",
    mode: "per_timestep",
    rows,
  };
}

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const rangeErrors = (s: Scenario, rows: PredictionRow[]): number[] =>
  rows
    .filter((r) => r.converged)
    .map((r) => {
      const tr = truthAt(s, Math.round(r.timestamp_s / s.metadata.parameters.dt_s)).range;
      return Math.abs(r.range_m - tr) / tr;
    });

const scen = Array.from({ length: 12 }, (_, i) => generateScenario(7n, i, PHASE4).scenario);

describe("EKF-fused tracker", () => {
  it("names the network, the EKF and the fusion settings, and parses back", () => {
    const name = fusedEkfName("lstm-gaussian", SA, SC, { k: 4, every: 12 });
    expect(name).toBe("fused-lstm-gaussian-ekf-sa0.03-p16-r64-g1-k4-m12");
    expect(parseFusedEkfName(name, "lstm-gaussian")).toEqual({
      sigmaA: SA,
      scales: SC,
      fusion: { k: 4, every: 12 },
    });
    expect(parseFusedName(name, "lstm-gaussian")).toBeNull();
    const imm = fusedName(
      "n",
      { sigmaCv: 0, sigmaCt: 0.03, sigmaOmega: 0.01, switchPerS: 0.001 },
      { k: 4, every: 6 },
    );
    expect(parseFusedEkfName(imm, "n")).toBeNull();
    expect(parseFusedEkfName(name.replace("-m12", "-m1.5"), "lstm-gaussian")).toBeNull();
  });

  it("an accurate range measurement pulls the EKF's range towards the truth", () => {
    const fused: number[] = [];
    const ekf: number[] = [];
    for (const s of scen) {
      fused.push(
        ...rangeErrors(s, fusedEkfPredict(s, SA, SC, network(s, 0.01), { k: 1, every: 1 }).rows),
      );
      ekf.push(...rangeErrors(s, ekfPredict(s, SA, SC).rows));
    }
    expect(median(fused)).toBeLessThan(0.2 * median(ekf));
  });

  it("adds nothing from rows that are not converged or state no sd", () => {
    for (const s of scen.slice(0, 3)) {
      const base = JSON.stringify(ekfPredict(s, SA, SC).rows);
      expect(JSON.stringify(fusedEkfPredict(s, SA, SC, network(s, 0.01, false)).rows)).toBe(base);
      expect(JSON.stringify(fusedEkfPredict(s, SA, SC, network(s, undefined)).rows)).toBe(base);
    }
  });

  it("the range update matches a finite difference of ln ρ and shrinks the covariance", () => {
    const p = new Float64Array(16);
    for (let i = 0; i < 4; i++) p[5 * i] = i < 2 ? 1e6 : 4;
    const st = { t: 0, x: Float64Array.from([3000, 4000, 1, 2]), p };
    const out = ekfRangeUpdate(st, 6000, 0.05, 100, -200);
    const rho = (x: number, y: number) => Math.hypot(x - 100, y + 200);
    // Moves towards the measured range, along the line of sight only.
    expect(rho(out.x[0] ?? 0, out.x[1] ?? 0)).toBeGreaterThan(rho(3000, 4000));
    expect(rho(out.x[0] ?? 0, out.x[1] ?? 0)).toBeLessThan(6000);
    const bearing = (x: number, y: number) => Math.atan2(x - 100, y + 200);
    expect(bearing(out.x[0] ?? 0, out.x[1] ?? 0)).toBeCloseTo(bearing(3000, 4000), 6);
    expect((out.p[0] ?? 0) + (out.p[5] ?? 0)).toBeLessThan(2e6);
  });

  it("is deterministic and refuses bad inputs", () => {
    const s = scen[1];
    if (s === undefined) throw new Error("no scenario");
    const a = JSON.stringify(fusedEkfPredict(s, SA, SC, network(s, 0.1)));
    expect(JSON.stringify(fusedEkfPredict(s, SA, SC, network(s, 0.1)))).toBe(a);
    expect(() => fusedEkfPredict(s, SA, SC, network(s, 0.1), { k: 0, every: 1 })).toThrow();
    expect(() => fusedEkfPredict(s, SA, SC, network(s, 0.1), { k: 1, every: 1.5 })).toThrow();
    // The IMM path is unchanged by the refactor (same rows as before for a fixed input).
    const imm = { sigmaCv: 0.01, sigmaCt: 0.03, sigmaOmega: 0.01, switchPerS: 0.001 };
    expect(fusedPredict(s, imm, network(s, 0.1)).estimator).toBe(
      fusedName("net", imm, { k: 4, every: 6 }),
    );
  });

  it("fades the network's weight as the filter's own range sd shrinks (spec 029)", () => {
    // fadedSd: unchanged at or above fade · s; inflated by fade · s / σ_f below; continuous.
    expect(fadedSd(0.4, 0.1, undefined)).toBe(0.4);
    expect(fadedSd(0.4, 0.1, 0)).toBe(0.4);
    expect(fadedSd(0.4, 0.5, 1)).toBe(0.4);
    expect(fadedSd(0.4, 0.4, 1)).toBeCloseTo(0.4, 12);
    expect(fadedSd(0.4, 0.1, 1)).toBeCloseTo(1.6, 12);
    expect(fadedSd(0.4, 0.2, 2)).toBeCloseTo(1.6, 12);
    expect(fadedSd(0.4, 0.05, 2)).toBeCloseTo(6.4, 12);
    // The filter's log-range sd is sqrt(H P Hᵀ).
    const p = new Float64Array(16);
    p[0] = 9e4;
    p[5] = 4e4;
    const st = { t: 0, x: Float64Array.from([3000, 4000, 0, 0]), p };
    expect(ekfLogRangeSd(st, 0, 0)).toBeCloseTo(
      Math.sqrt((3000 / 25e6) ** 2 * 9e4 + (4000 / 25e6) ** 2 * 4e4),
      12,
    );
    // Fade 0 is the phase-15 tracker, byte for byte, and its name has no -f suffix.
    const s = scen[2];
    if (s === undefined) throw new Error("no scenario");
    const f0 = fusedEkfPredict(s, SA, SC, network(s, 0.1), { k: 4, every: 3, fade: 0 });
    const plain = fusedEkfPredict(s, SA, SC, network(s, 0.1), { k: 4, every: 3 });
    expect(JSON.stringify(f0)).toBe(JSON.stringify(plain));
    // A strong fade moves the rows towards the plain EKF's.
    const ekf = ekfPredict(s, SA, SC).rows;
    const far = fusedEkfPredict(s, SA, SC, network(s, 0.3, true), { k: 1, every: 1, fade: 1e6 });
    const near = fusedEkfPredict(s, SA, SC, network(s, 0.3, true), { k: 1, every: 1 });
    const gap = (rows: PredictionRow[]) =>
      median(rows.map((r, i) => Math.abs(r.range_m - (ekf[i]?.range_m ?? 0))));
    expect(gap(far.rows)).toBeLessThan(gap(near.rows));
    // Names: -f<c> round-trips; the IMM fusion refuses a fade.
    const name = fusedEkfName("net", 0.03, SC, { k: 4, every: 3, fade: 0.5 });
    expect(name).toBe("fused-net-ekf-sa0.03-p16-r64-g1-k4-m3-f0.5");
    expect(parseFusedEkfName(name, "net")?.fusion).toEqual({ k: 4, every: 3, fade: 0.5 });
    expect(parseFusedName(name, "net")).toBeNull();
    const imm = { sigmaCv: 0.01, sigmaCt: 0.03, sigmaOmega: 0.01, switchPerS: 0.001 };
    expect(() => fusedPredict(s, imm, network(s, 0.1), { k: 4, every: 6, fade: 1 })).toThrow(
      /EKF fusion only/,
    );
    expect(() =>
      fusedEkfPredict(s, SA, SC, network(s, 0.1), { k: 4, every: 3, fade: -1 }),
    ).toThrow();
  });
});
