// Spec 012 FR-005: G5 for one or two learned trackers against the frozen reference (gate-g5.ts).
import { readFileSync } from "node:fs";
import { degToRad, generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { bootstrapClusteredQuantileRatio, bootstrapQuantileRatio } from "../src/bootstrap.js";
import { g5Checks, g5Rows, g5Verdict, settledRow, trackerResult } from "../src/gate-g5.js";
import { set, truthRow } from "./helpers.js";

const RANGES = {
  ...(JSON.parse(
    readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
  ) as ParameterRanges),
  noise_sigma_rad_values: [degToRad(1)],
};
const SCEN: Scenario[] = Array.from(
  { length: 80 },
  (_, i) => generateScenario(41n, i, RANGES).scenario,
);

function perTimestep(
  s: Scenario,
  estimator: string,
  f: (r: PredictionRow, i: number, s: Scenario) => PredictionRow,
): Prediction {
  const rows: PredictionRow[] = [];
  for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++)
    rows.push(f(truthRow(s, i), i, s));
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator,
    mode: "per_timestep",
    rows,
  };
}
const mk = (label: string, f: (r: PredictionRow, i: number, s: Scenario) => PredictionRow) =>
  set(
    label,
    SCEN.map((s) => perTimestep(s, label, f)),
  );
/** Errors scaled by k on settled rows and by u elsewhere (spread by row parity). */
const err =
  (k: number, u = k) =>
  (r: PredictionRow, i: number, s: Scenario): PredictionRow => {
    const f = settledRow(s.metadata, i) ? k : u;
    return {
      ...r,
      range_m: r.range_m * (1 + 0.1 * f * (1 + (i % 3) * 0.2)),
      course_rad: r.course_rad + 0.05 * f * (1 + (i % 2)),
      speed_mps: r.speed_mps + 0.2 * f * (1 + (i % 2) * 0.5),
    };
  };

describe("G5 rows and settled rows", () => {
  it("are σ = 1° rows at zig + 5/10/15/20 min, clustered by scenario", () => {
    const rows = g5Rows(SCEN);
    expect(rows.length).toBeGreaterThan(SCEN.length * 2);
    for (const r of rows)
      expect(r.k).toBe(r.s.metadata.zig_index + (r.minutes * 60) / r.s.metadata.parameters.dt_s);
    const clusters = new Set(rows.map((r) => r.cluster));
    expect(clusters.size).toBe(SCEN.length);
  });

  it("settled: not in a manoeuvre, and none started yet or the last ended ≥ 5 min before", () => {
    const first = SCEN[0];
    if (first === undefined) throw new Error("no scenario");
    const m = {
      ...first.metadata,
      manoeuvres: [
        { kind: "course" as const, start_index: 50, end_index: 60 },
        { kind: "speed" as const, start_index: 100, end_index: 105 },
      ],
    };
    expect(settledRow(m, 49)).toBe(true); // before any manoeuvre
    expect(settledRow(m, 55)).toBe(false); // inside one
    expect(settledRow(m, 70)).toBe(false); // 100 s after it ended
    expect(settledRow(m, 90)).toBe(true); // 300 s after
    expect(settledRow(m, 120)).toBe(false); // 150 s after the second
  });
});

describe("the clustered bootstrap", () => {
  it("is wider than the row bootstrap when rows in a scenario are correlated", () => {
    const a = new Float64Array(400);
    const b = new Float64Array(400);
    const c = new Int32Array(400);
    for (let i = 0; i < 400; i++) {
      const g = Math.floor(i / 4);
      c[i] = g;
      a[i] = 1 + ((g * 37) % 11) / 10;
      b[i] = 1 + ((g * 53) % 7) / 10;
    }
    const row = bootstrapQuantileRatio(a, b, 0.5);
    const cl = bootstrapClusteredQuantileRatio(a, b, c, 0.5, 0.95);
    expect(cl.ratio).toBeCloseTo(row.ratio, 12);
    expect(cl.hi - cl.lo).toBeGreaterThan(row.hi - row.lo);
    expect(cl.clusters).toBe(100);
  });
});

describe("G5 checks and verdict", () => {
  const ref = mk("ref", err(1));

  it("passes a tracker better overall and no worse settled", () => {
    const t = mk("T2", err(0.9, 0.5));
    const checks = g5Checks(SCEN, t, ref, 300);
    expect(trackerResult(checks, "T2")).toBe("pass");
    expect(g5Verdict(checks, ["T2"]).result).toBe("pass");
    for (const c of checks) expect(c.ci_level).toBe(0.975);
  });

  it("fails a tracker that wins after manoeuvres but loses settled (phase 3's trade)", () => {
    const t = mk("T2", err(1.6, 0.3));
    const checks = g5Checks(SCEN, t, ref, 300);
    const by = Object.fromEntries(checks.map((c) => [c.name, c.result]));
    expect(by["T2:g5-settled-range"]).toBe("fail");
    expect(trackerResult(checks, "T2")).toBe("fail");
  });

  it("passes when either of two trackers passes, fails only when both fail", () => {
    const good = mk("T1", err(0.9, 0.5));
    const bad = mk("T2", err(2, 2));
    const both = [...g5Checks(SCEN, good, ref, 300), ...g5Checks(SCEN, bad, ref, 300)];
    expect(g5Verdict(both, ["T1", "T2"]).result).toBe("pass");
    const bad1 = mk("T1", err(2, 2));
    const none = [...g5Checks(SCEN, bad1, ref, 300), ...g5Checks(SCEN, bad, ref, 300)];
    expect(g5Verdict(none, ["T1", "T2"]).result).toBe("fail");
  });
});
