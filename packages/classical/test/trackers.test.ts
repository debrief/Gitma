// EKF and IMM (spec 010; SRD Annex B §B.3): motion models against the generator's arc, noise-free
// agreement with the truth before any target turn, and re-convergence after one.
import { readFileSync } from "node:fs";
import {
  arcPosition,
  createRng,
  degToRad,
  generateScenario,
  noiseFree,
  observe,
  simulateTruth,
} from "@tma/sim";
import type { ParameterRanges, Scenario, ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { ekfPredict } from "../src/ekf.js";
import { ctMotion, cvMotion, type ImmParams, immPredict } from "../src/imm.js";
import { truthAt } from "./helpers.js";

const PHASE3 = noiseFree(
  JSON.parse(
    readFileSync(new URL("../../../configs/phase3-ranges.json", import.meta.url), "utf8"),
  ) as ParameterRanges,
);
const IMM_P: ImmParams = { sigmaCv: 0.001, sigmaCt: 0.01, sigmaOmega: 0.001, switchPerS: 0.001 };

describe("motion models", () => {
  it("coordinated turn matches the generator's arc, both directions", () => {
    for (const w of [degToRad(1), degToRad(-2.5)]) {
      for (const c0 of [0, 1.1, 4]) {
        const v = 5;
        const s = Float64Array.from([10, -20, v * Math.sin(c0), v * Math.cos(c0), w]);
        const m = ctMotion(s, 73);
        const a = arcPosition(10, -20, c0, v, w, 73);
        expect(m[0]).toBeCloseTo(a.x, 9);
        expect(m[1]).toBeCloseTo(a.y, 9);
        expect(m[2]).toBeCloseTo(v * Math.sin(a.course), 9);
        expect(m[3]).toBeCloseTo(v * Math.cos(a.course), 9);
      }
    }
  });
  it("as ω → 0 the turn is constant velocity", () => {
    const s = Float64Array.from([1, 2, 3, -4, 1e-12]);
    const a = ctMotion(s, 10);
    const b = cvMotion(s, 10);
    for (let k = 0; k < 4; k++) expect(a[k]).toBeCloseTo(b[k] ?? NaN, 9);
  });
});

/** Worst relative range error over rows at or after `from` and before `to`. */
function worst(
  s: Scenario,
  rows: { range_m: number; converged: boolean }[],
  from: number,
  to: number,
) {
  const first = s.metadata.zig_index + 1;
  let w = 0;
  for (let i = Math.max(from, first); i < to; i++) {
    const r = rows[i - first];
    if (r === undefined || !r.converged) return Infinity;
    const tr = truthAt(s, i).range;
    w = Math.max(w, Math.abs(r.range_m - tr) / tr);
  }
  return w;
}

describe("noise-free: before any target turn the trackers hold the truth", () => {
  const scen = Array.from({ length: 40 }, (_, i) => generateScenario(5n, i, PHASE3).scenario);
  it("EKF (σ_a = 0) and IMM within 0.1% range from zig + 60 s to the turn (or the end)", () => {
    for (const s of scen) {
      const m = s.metadata;
      const to = m.manoeuvre_start_index ?? m.samples;
      const from = m.zig_index + 7;
      expect(worst(s, ekfPredict(s, 0).rows, from, to)).toBeLessThan(1e-3);
      expect(worst(s, immPredict(s, IMM_P).rows, from, to)).toBeLessThan(1e-3);
    }
  });
});

describe("noise-free: after a target turn followed by an ownship zig", () => {
  // Ownship north at 5 m/s zigs +90° at sample 60 (1°/s); the target, 4 m/s west, turns +90° at
  // t = 900 s (1°/s, done at sample 99); ownship's second zig (−90°) starts at sample 129.
  const p: ScenarioParameters = {
    window_s: 2400,
    dt_s: 10,
    ownship_speed_mps: 5,
    ownship_course0_rad: 0,
    zig_angle_rad: degToRad(90),
    zig_fraction: 0.25,
    ownship_turn_rate_rad_s: degToRad(1),
    target_range0_m: 8000,
    target_bearing0_rad: degToRad(45),
    target_speed_mps: 4,
    target_course_rad: degToRad(270),
    noise_sigma_rad: 0,
    dropout_fraction: 0,
    zig2_delay_s: 600,
    zig2_angle_rad: degToRad(-90),
    target_manoeuvre_time_s: 900,
    target_manoeuvre_angle_rad: degToRad(90),
    target_turn_rate_rad_s: degToRad(1),
  };
  const tr = simulateTruth(p);
  const st = (x: Float64Array, y: Float64Array, c: Float64Array, v: number) =>
    Array.from({ length: tr.samples }, (_, i) => ({
      timestamp_s: i * 10,
      x_m: x[i] ?? 0,
      y_m: y[i] ?? 0,
      course_rad: c[i] ?? 0,
      speed_mps: v,
    }));
  const s: Scenario = {
    record: "scenario",
    metadata: {
      seed: "1",
      index: 0,
      parameters: p,
      samples: tr.samples,
      zig_index: tr.zigIndex,
      zig_time_s: tr.zigIndex * 10,
      mean_range_m: 0,
      min_range_m: 0,
    },
    ownship: { id: "ownship", states: st(tr.ownX, tr.ownY, tr.ownCourse, 5) },
    target: { id: "target", states: st(tr.tgtX, tr.tgtY, tr.tgtCourse, 4) },
    observations: observe(createRng(1n), p, tr),
  };
  const end = tr.samples;

  it("the IMM re-converges: within 0.5% range over the last 10 minutes", () => {
    expect(worst(s, immPredict(s, IMM_P).rows, end - 60, end)).toBeLessThan(5e-3);
  });

  it("the single-model EKF does not (Aidala's Cartesian instability): over 10% at the end", () => {
    // Recorded, not a requirement: why the gated reference is the IMM.
    expect(worst(s, ekfPredict(s, 0.01).rows, end - 1, end)).toBeGreaterThan(0.1);
  });
});

describe("guards", () => {
  it("rejects negative tuning", () => {
    const s = generateScenario(5n, 0, PHASE3).scenario;
    expect(() => ekfPredict(s, -1)).toThrow();
    expect(() => immPredict(s, { ...IMM_P, sigmaCv: -1 })).toThrow();
  });
  it("is deterministic", () => {
    const s = generateScenario(5n, 1, PHASE3).scenario;
    expect(JSON.stringify(immPredict(s, IMM_P))).toBe(JSON.stringify(immPredict(s, IMM_P)));
  });
});
