// Spec 017: the manoeuvre detectors (CUSUM on the IMM's innovations; course disagreement and
// course rate from prediction records) and their round-trip names.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  courseRateDetect,
  courseRateName,
  cusumDetect,
  cusumName,
  disagreementDetect,
} from "../src/detect.js";
import { type ImmParams, immPredict } from "../src/imm.js";
import { parseCourseRateName, parseCusumName } from "../src/names.js";

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

/** A stand-in network with the given course at each sample (rows from zig_index + 1). */
function net(s: Scenario, course: (i: number) => number, converged = true): Prediction {
  const rows: PredictionRow[] = [];
  for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++)
    rows.push({
      timestamp_s: s.ownship.states[i]?.timestamp_s ?? 0,
      range_m: 5000,
      course_rad: course(i),
      speed_mps: 4,
      x_m: 0,
      y_m: 0,
      converged,
    });
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: "net",
    mode: "per_timestep",
    rows,
  };
}

const scen = Array.from({ length: 40 }, (_, i) => generateScenario(17n, i, PHASE4).scenario);
const turning = scen.filter((s) =>
  (s.metadata.manoeuvres ?? []).some(
    (m) => m.kind === "course" && m.start_index > s.metadata.zig_index + 12,
  ),
);

describe("manoeuvre detectors (spec 017)", () => {
  it("round-trip their names", () => {
    const q = { kind: "mean", c: 0.5, clip: 3 } as const;
    const n = cusumName(REF, q);
    expect(n).toBe("cusum-mean-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-c0.5-x3");
    expect(parseCusumName(n)).toEqual({ imm: REF, cusum: q });
    expect(parseCusumName(cusumName(REF, { kind: "nis", c: 1, clip: 5 }))?.cusum.kind).toBe("nis");
    expect(parseCusumName("cusum-imm-x-c1-x3")).toBeNull();
    expect(parseCusumName("cusum-var-imm-cv0.01-ct0.03-w0.01-s0.001-c1-x3")).toBeNull();
    expect(parseCusumName(n.replace("-c0.5-", "-c0.50-"))).toBeNull(); // not how String() prints 0.5
    expect(parseCourseRateName(courseRateName("lstm-gaussian", 6), "lstm-gaussian")).toBe(6);
    expect(parseCourseRateName("crate-lstm-gaussian-w06", "lstm-gaussian")).toBeNull();
  });

  it("CUSUM follows its clipped recursion, restarts without a state, and the mean-shift kind rises after course changes", () => {
    expect(turning.length).toBeGreaterThan(3);
    let after = 0;
    let before = 0;
    for (const kind of ["nis", "mean"] as const) {
      const q = { kind, c: kind === "nis" ? 1 : 0.5, clip: 3 };
      for (const s of turning) {
        const d = cusumDetect(s, REF, q);
        const stat = new Map<number, number | null>();
        const p = immPredict(s, REF, (i, st) =>
          stat.set(i, (kind === "nis" ? st.nis : st.innovation) ?? null),
        );
        expect(d.rows.map((r) => r.timestamp_s)).toEqual(p.rows.map((r) => r.timestamp_s));
        const dt = s.metadata.parameters.dt_s;
        let up = 0;
        let down = 0;
        for (const r of d.rows) {
          const i = Math.round(r.timestamp_s / dt);
          if (!stat.has(i)) up = down = 0;
          else {
            const v = stat.get(i);
            if (v != null) {
              if (kind === "nis") up = Math.max(0, up + Math.min(v, q.clip) - q.c);
              else {
                const e = Math.max(-q.clip, Math.min(q.clip, v));
                up = Math.max(0, up + e - q.c);
                down = Math.max(0, down - e - q.c);
              }
            }
          }
          expect(r.score).toBe(Math.fround(Math.max(up, down)));
          expect(r.score).toBeGreaterThanOrEqual(0);
        }
        if (kind !== "mean") continue;
        const start =
          (s.metadata.manoeuvres ?? []).find((m) => m.kind === "course")?.start_index ?? 0;
        for (const r of d.rows) {
          const k = Math.round(r.timestamp_s / dt);
          if (k >= start && k < start + 30) after += r.score / 30;
          if (k >= start - 6 && k < start) before += r.score / 6;
        }
      }
    }
    expect(after).toBeGreaterThan(before);
    const s0 = scen[0] as Scenario;
    expect(() => cusumDetect(s0, REF, { kind: "nis", c: 0, clip: 3 })).toThrow(/drift/);
    expect(() => cusumDetect(s0, REF, { kind: "nis", c: 1, clip: 0 })).toThrow(/clip/);
  });

  it("course disagreement is |Δcourse| in degrees, 0 where either row has no estimate", () => {
    const s = scen[0] as Scenario;
    const a = net(s, () => 0.1);
    const b = net(s, () => 0.1 + Math.PI / 6);
    const d = disagreementDetect(a, b);
    expect(d.rows.every((r) => Math.abs(r.score - 30) < 1e-4)).toBe(true);
    // Wrapped: 359° against 1° is 2°.
    const w = disagreementDetect(
      net(s, () => (359 * Math.PI) / 180),
      net(s, () => Math.PI / 180),
    );
    expect(w.rows.every((r) => Math.abs(r.score - 2) < 1e-4)).toBe(true);
    expect(
      disagreementDetect(
        a,
        net(s, () => 3, false),
      ).rows.every((r) => r.score === 0),
    ).toBe(true);
    expect(() => disagreementDetect(a, { ...b, scenario_index: 99 })).toThrow(/scenarios/);
  });

  it("course rate is 0 on a held course and sees a step for exactly w rows", () => {
    const s = scen[0] as Scenario;
    const k0 = s.metadata.zig_index + 20;
    const d = courseRateDetect(
      net(s, (i) => (i >= k0 ? 0.5 : 0)),
      6,
    );
    const dt = s.metadata.parameters.dt_s;
    const high = d.rows.filter((r) => r.score > 1).map((r) => Math.round(r.timestamp_s / dt));
    expect(high).toEqual([k0, k0 + 1, k0 + 2, k0 + 3, k0 + 4, k0 + 5]);
    expect(() =>
      courseRateDetect(
        net(s, () => 0),
        0,
      ),
    ).toThrow(/window/);
  });
});
