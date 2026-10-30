// Generator 0.5.0 (spec 012; SRD Annex C §C.2): 0–3 target course changes and an optional speed
// change. Known answers are hand-computed; the generated-scenario checks hold for every scenario the
// phase-4 ranges produce.
import { readFileSync } from "node:fs";
import type { ParameterRanges, ScenarioParameters } from "@tma/types";
import { describe, expect, it } from "vitest";
import { angleDiff, degToRad } from "../../src/geometry.js";
import { drawManoeuvreCount, generateScenario, simulateTruth } from "../../src/scenario.js";
import { deriveSeed } from "../../src/prng.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
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

describe("target manoeuvres: known answers", () => {
  it("a speed change accelerates along the course and holds the new speed", () => {
    // +5 m/s at 0.1 m/s² from t = 600 s at (8000, 3000): 50 s long, 375 m.
    const p = {
      ...base,
      target_manoeuvres: [{ kind: "speed" as const, start_time_s: 600, change: 5, rate: 0.1 }],
    };
    const t = simulateTruth(p);
    expect(t.tgtX[63]).toBeCloseTo(8000, 9);
    expect(t.tgtY[63]).toBeCloseTo(3000 + 5 * 30 + 0.5 * 0.1 * 900, 9);
    expect(t.tgtSpeed[63]).toBeCloseTo(8, 12);
    expect(t.tgtY[80]).toBeCloseTo(3000 + 375 + 10 * 150, 9);
    expect(t.tgtSpeed[80]).toBe(10);
    expect(t.tgtCourse[80]).toBe(0);
    expect(t.manoeuvres).toEqual([{ kind: "speed", startIndex: 61, endIndex: 65 }]);
    expect(t.manoeuvreStartIndex).toBe(61);
    expect(t.manoeuvreIndex).toBe(65);
  });

  it("two turns in sequence end where the arcs and the leg between them put the target", () => {
    const p = {
      ...base,
      target_manoeuvres: [
        { kind: "course" as const, start_time_s: 600, change: Math.PI / 2, rate: W },
        { kind: "course" as const, start_time_s: 750, change: -Math.PI / 2, rate: W },
      ],
    };
    const t = simulateTruth(p);
    // First arc ends at t = 690 s at (8000 + R, 3000 + R) heading east; 60 s east; the port arc
    // ends at t = 840 s a further (R, R) on, heading north; then 60 s north to t = 900 s.
    expect(t.tgtX[90]).toBeCloseTo(8000 + 2 * R + 300, 6);
    expect(t.tgtY[90]).toBeCloseTo(3000 + 2 * R + 300, 6);
    expect(Math.abs(angleDiff(t.tgtCourse[90] ?? NaN, 0))).toBeLessThan(1e-12);
    expect(t.manoeuvres?.map((m) => [m.startIndex, m.endIndex])).toEqual([
      [61, 69],
      [76, 84],
    ]);
  });

  it("an empty plan holds course and speed", () => {
    const t = simulateTruth({ ...base, target_manoeuvres: [] });
    const held = simulateTruth(base);
    expect(Array.from(t.tgtX)).toEqual(Array.from(held.tgtX));
    expect(t.manoeuvres).toEqual([]);
    expect(t.manoeuvreIndex).toBeNull();
  });
});

describe("target manoeuvres: generated scenarios (phase-4 ranges)", () => {
  const N = 600;
  const scenarios = Array.from({ length: N }, (_, i) => generateScenario(11n, i, PHASE4).scenario);

  it("realise the declared count distribution, because the count survives redraws", () => {
    for (let i = 0; i < 50; i++) {
      const s = scenarios[i];
      if (s === undefined) continue;
      const want = drawManoeuvreCount(deriveSeed(11n, i), PHASE4);
      const plan = s.metadata.parameters.target_manoeuvres ?? [];
      expect(plan.filter((m) => m.kind === "course").length).toBe(want.courseChanges);
      expect(plan.some((m) => m.kind === "speed")).toBe(want.speedChange);
    }
    const counts = [0, 0, 0, 0];
    for (const s of scenarios) {
      const n = (s.metadata.parameters.target_manoeuvres ?? []).filter((m) => m.kind === "course");
      counts[n.length] = (counts[n.length] ?? 0) + 1;
    }
    // P = 0.2, 0.3, 0.3, 0.2 with n = 600: each share within 0.06 (about 3 sd).
    [0.2, 0.3, 0.3, 0.2].forEach((p, k) => {
      expect(Math.abs((counts[k] ?? 0) / N - p)).toBeLessThan(0.06);
    });
  });

  it("never overlap, respect the timing rules and keep the speed in range", () => {
    const dt = PHASE4.dt_s;
    for (const s of scenarios) {
      const m = s.metadata;
      const spans = m.manoeuvres ?? [];
      expect(spans.length).toBe((m.parameters.target_manoeuvres ?? []).length);
      spans.forEach((sp, j) => {
        if (j === 0)
          expect(sp.start_index - 1).toBeGreaterThanOrEqual(
            m.zig_index + Math.ceil((PHASE4.target_manoeuvre_after_zig_s ?? 0) / dt),
          );
        const prev = spans[j - 1];
        if (prev !== undefined)
          expect(sp.start_index - 1 - prev.end_index).toBeGreaterThanOrEqual(
            Math.ceil((PHASE4.target_manoeuvre_spacing_s ?? 0) / dt),
          );
      });
      const last = spans[spans.length - 1];
      if (last !== undefined)
        expect(last.end_index).toBeLessThanOrEqual(
          m.samples - 1 - Math.ceil((PHASE4.target_manoeuvre_margin_s ?? 0) / dt),
        );
      for (const st of s.target.states) {
        expect(st.speed_mps).toBeGreaterThanOrEqual(PHASE4.target_speed_mps.min - 1e-3);
        expect(st.speed_mps).toBeLessThanOrEqual(PHASE4.target_speed_mps.max + 1e-3);
      }
      expect(m.manoeuvre_start_index).toBe(spans[0]?.start_index);
      expect(m.manoeuvre_index).toBe(last?.end_index);
    }
  });
});
