// Spec 009: G3 for the hybrid against classical (gate-g3.ts) and its bootstraps.
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  bootstrapMedianRatio,
  bootstrapQuantileRatio,
  bootstrapRateDifference,
} from "../src/bootstrap.js";
import { g3Checks, g3Verdict, judge } from "../src/gate-g3.js";
import { scenarios, set, truthRow } from "./helpers.js";

/** Per-timestep predictions from zig_index + 1, each row derived from the truth row. */
function perTimestep(
  s: Scenario,
  estimator: string,
  f: (r: PredictionRow, i: number) => PredictionRow,
): Prediction {
  const rows: PredictionRow[] = [];
  for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++)
    rows.push(f(truthRow(s, i), i));
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator,
    mode: "per_timestep",
    rows,
  };
}

/** Range scaled by k, speed off by dv m/s, course off by dc rad. */
const off =
  (k: number, dv: number, dc: number) =>
  (r: PredictionRow): PredictionRow => ({
    ...r,
    range_m: r.range_m * k,
    speed_mps: r.speed_mps + dv,
    course_rad: r.course_rad + dc,
  });

describe("G3 bootstraps", () => {
  const a = Float64Array.from({ length: 200 }, (_, i) => (i % 17) + 1);
  const b = Float64Array.from({ length: 200 }, (_, i) => (i % 13) + 2);
  it("the quantile ratio at 0.5 is the median ratio", () => {
    expect(bootstrapQuantileRatio(a, b, 0.5, 300)).toEqual(bootstrapMedianRatio(a, b, 300));
  });
  it("the P90 ratio uses nearest-rank 90th percentiles", () => {
    const r = bootstrapQuantileRatio(a, b, 0.9, 300);
    expect(r.ratio).toBeCloseTo(16 / 13, 12);
    expect(r.lo).toBeLessThanOrEqual(r.ratio);
    expect(r.hi).toBeGreaterThanOrEqual(r.ratio);
  });
  it("the rate difference is paired and seeded", () => {
    const x = new Uint8Array(1000);
    const y = Uint8Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? 1 : 0));
    const d = bootstrapRateDifference(x, y, 500);
    expect(d.difference).toBeCloseTo(-0.1, 12);
    expect(d.hi).toBeLessThan(0);
    expect(bootstrapRateDifference(x, y, 500)).toEqual(d);
    expect(() => bootstrapRateDifference(x, new Uint8Array(3))).toThrow(/equal/);
  });
});

describe("G3 checks (FR-015 against 1.2 × classical and a lower gross-error rate)", () => {
  it("judges pass, fail and inconclusive", () => {
    expect(judge(1.0, 0.9, 1.1, 1.2)).toBe("pass");
    expect(judge(1.1, 1.0, 1.25, 1.2)).toBe("inconclusive");
    expect(judge(1.3, 1.2, 1.4, 1.2)).toBe("fail");
    expect(judge(-0.01, -0.02, -0.005, 0)).toBe("pass");
    expect(judge(0, 0, 0, 0)).toBe("fail");
  });

  const ss = scenarios(9101n, 40);
  // Classical: 10% range error, 0.5 m/s, 0.02 rad, and a gross range error on every 8th scenario.
  const classical = set(
    "classical:per_timestep",
    ss.map((s) =>
      perTimestep(s, "classical", (r) => off(s.metadata.index % 8 === 0 ? 3 : 1.1, 0.5, 0.02)(r)),
    ),
  );

  it("passes a hybrid as good as classical with fewer gross errors", () => {
    const hybrid = set(
      "hybrid-lstm:per_timestep",
      ss.map((s) => perTimestep(s, "hybrid-lstm", off(1.1, 0.5, 0.02))),
    );
    const checks = g3Checks(ss, hybrid, classical, 300, 20261011n, "overall");
    expect(checks.map((c) => c.name)).toEqual([
      "g3-range-median",
      "g3-range-p90",
      "g3-course-median",
      "g3-course-p90",
      "g3-speed-median",
      "g3-speed-p90",
      "g3-gross-error-rate",
    ]);
    expect(checks.map((c) => c.result)).toEqual(Array(7).fill("pass"));
    expect(g3Verdict(checks)).toMatchObject({ gate: "G3", result: "pass" });
  });

  it("fails a hybrid twice as far off, and one with the same gross errors", () => {
    const hybrid = set(
      "hybrid-lstm:per_timestep",
      ss.map((s) =>
        perTimestep(s, "hybrid-lstm", off(s.metadata.index % 8 === 0 ? 3 : 1.2, 1, 0.04)),
      ),
    );
    const checks = g3Checks(ss, hybrid, classical, 300, 20261011n, "overall");
    expect(checks.find((c) => c.name === "g3-range-median")?.result).toBe("fail");
    expect(checks.find((c) => c.name === "g3-speed-median")?.result).toBe("fail");
    expect(checks.find((c) => c.name === "g3-gross-error-rate")?.result).toBe("fail");
    expect(g3Verdict(checks).result).toBe("fail");
  });
});
