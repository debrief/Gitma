// Generator 0.4.0 (spec 010 FR-001; SRD Annex B §B.2): one rate-limited target course change.
// Known answers are hand-computed; the generated-scenario checks hold for every scenario the
// phase-3 ranges produce.
import { readFileSync } from "node:fs";
import type { ParameterRanges, ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, degToRad } from "../../src/geometry.js";
import { DEFAULT_RANGES } from "../../src/ranges.js";
import { generateScenario, simulateTruth } from "../../src/scenario.js";

const PHASE3 = JSON.parse(
  readFileSync(new URL("../../../../configs/phase3-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;

const W = degToRad(1);
const V = 5;
const R = V / W;

const base: ScenarioParameters = {
  window_s: 1200,
  dt_s: 10,
  ownship_speed_mps: 5,
  ownship_course0_rad: 0,
  zig_angle_rad: degToRad(90),
  zig_fraction: 0.5,
  target_range0_m: 8000,
  target_bearing0_rad: Math.PI / 2,
  target_speed_mps: V,
  target_course_rad: 0,
  noise_sigma_rad: 0,
  dropout_fraction: 0,
};

describe("target manoeuvre: known answers", () => {
  const turn = {
    ...base,
    target_manoeuvre_time_s: 800,
    target_manoeuvre_angle_rad: degToRad(90),
    target_turn_rate_rad_s: W,
  };
  const tr = simulateTruth(turn);
  const x0 = 8000;
  const y0 = V * 800; // north at 5 m/s for 800 s

  it("indices: the arc starts after sample 80 and leg 2 starts at sample 89 (90 s at 10 s)", () => {
    expect(tr.manoeuvreStartIndex).toBe(81);
    expect(tr.manoeuvreIndex).toBe(89);
  });

  it("straight on course 0 up to the turn", () => {
    expect(tr.tgtX[80]).toBeCloseTo(x0, 9);
    expect(tr.tgtY[80]).toBeCloseTo(y0, 9);
    expect(tr.tgtCourse[80]).toBe(0);
  });

  it("a mid-turn sample lies on the arc of radius v/ω about (x0 + r, y0), heading 50°", () => {
    expect(Math.hypot((tr.tgtX[85] ?? 0) - (x0 + R), (tr.tgtY[85] ?? 0) - y0)).toBeCloseTo(R, 9);
    expect(tr.tgtCourse[85]).toBeCloseTo(degToRad(50), 12);
  });

  it("after the turn: due east from (x0 + r, y0 + r) at v", () => {
    // 90 s of turn, so sample 89 (890 s) is 0 s after the arc ends; sample 100 is 110 s after.
    expect(tr.tgtX[89]).toBeCloseTo(x0 + R, 9);
    expect(tr.tgtY[89]).toBeCloseTo(y0 + R, 9);
    expect(tr.tgtX[100]).toBeCloseTo(x0 + R + V * 110, 9);
    expect(tr.tgtY[100]).toBeCloseTo(y0 + R, 9);
    expect(tr.tgtCourse[100]).toBeCloseTo(Math.PI / 2, 12);
  });

  it("a port turn mirrors it", () => {
    const port = simulateTruth({ ...turn, target_manoeuvre_angle_rad: degToRad(-90) });
    expect(port.tgtX[100]).toBeCloseTo(x0 - R - V * 110, 9);
    expect(port.tgtY[100]).toBeCloseTo(y0 + R, 9);
    expect(port.tgtCourse[100]).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it("ownship is unchanged by the target's turn", () => {
    const held = simulateTruth(base);
    expect(Array.from(tr.ownX)).toEqual(Array.from(held.ownX));
    expect(Array.from(tr.ownY)).toEqual(Array.from(held.ownY));
    expect(Array.from(tr.tgtX.subarray(0, 81))).toEqual(Array.from(held.tgtX.subarray(0, 81)));
  });

  it("a held-course target has no manoeuvre indices and a constant course", () => {
    const held = simulateTruth(base);
    expect(held.manoeuvreStartIndex).toBeNull();
    expect(held.manoeuvreIndex).toBeNull();
    expect(new Set(held.tgtCourse).size).toBe(1);
  });
});

describe("generator 0.4.0 on the phase-3 ranges", () => {
  const N = 400;
  const scen = Array.from({ length: N }, (_, i) => generateScenario(7n, i, PHASE3).scenario);

  it("about 80% of targets turn (binomial, n = 400: within ±4 standard errors)", () => {
    const turned = scen.filter((s) => s.metadata.manoeuvre_index !== undefined).length;
    expect(Math.abs(turned / N - 0.8)).toBeLessThan(4 * Math.sqrt((0.8 * 0.2) / N));
  });

  it("every turn starts ≥ 2 min after leg 2 starts and ends ≥ 6 min before the window ends", () => {
    for (const s of scen) {
      const m = s.metadata;
      if (m.manoeuvre_index === undefined) continue;
      const start = (m.manoeuvre_start_index ?? 0) - 1;
      expect(start).toBeGreaterThanOrEqual(m.zig_index + 12);
      expect(m.manoeuvre_index).toBeLessThanOrEqual(m.samples - 1 - 36);
    }
  });

  it("the track's course changes by the drawn angle, at constant speed, within the drawn limits", () => {
    for (const s of scen) {
      const p = s.metadata.parameters;
      const t = s.target.states;
      const first = t[0];
      const last = t[t.length - 1];
      if (first === undefined || last === undefined) throw new Error("empty track");
      for (const st of t) expect(st.speed_mps).toBe(p.target_speed_mps);
      if (s.metadata.manoeuvre_index === undefined) {
        expect(last.course_rad).toBe(first.course_rad);
        expect(p.target_manoeuvre_angle_rad).toBeUndefined();
        continue;
      }
      const a = p.target_manoeuvre_angle_rad ?? 0;
      const rate = p.target_turn_rate_rad_s ?? 0;
      expect(Math.abs(a)).toBeGreaterThanOrEqual(degToRad(30) - 1e-6);
      expect(Math.abs(a)).toBeLessThanOrEqual(degToRad(120) + 1e-6);
      expect(rate).toBeGreaterThanOrEqual(degToRad(0.5) - 1e-7);
      expect(rate).toBeLessThanOrEqual(degToRad(3) + 1e-7);
      expect(angleDiff(last.course_rad, first.course_rad)).toBeCloseTo(a, 5);
    }
  });

  it("positions are continuous: each step moves v·dt at most (a chord of an arc is shorter)", () => {
    for (const s of scen) {
      const p = s.metadata.parameters;
      const t = s.target.states;
      for (let i = 1; i < t.length; i++) {
        const a = t[i - 1];
        const b = t[i];
        if (a === undefined || b === undefined) continue;
        const d = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
        expect(d).toBeLessThanOrEqual(p.target_speed_mps * p.dt_s * (1 + 1e-5) + 0.01);
      }
    }
  });

  it("is deterministic", () => {
    const again = generateScenario(7n, 3, PHASE3).scenario;
    expect(JSON.stringify(again)).toBe(JSON.stringify(scen[3]));
  });

  it("without a manoeuvre fraction the ranges draw as generator 0.3.0 (no manoeuvre fields)", () => {
    const s = generateScenario(7n, 0, { ...DEFAULT_RANGES }).scenario;
    expect(s.metadata.manoeuvre_index).toBeUndefined();
    expect(s.metadata.parameters.target_manoeuvre_time_s).toBeUndefined();
  });
});
