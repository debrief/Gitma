// Spec 010: G4 for the carried network against the frozen reference tracker (gate-g4.ts).
import { readFileSync } from "node:fs";
import { degToRad, generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { g4Checks, g4Rows, g4Verdict, judgeAtOrBelow } from "../src/gate-g4.js";
import { set, truthRow } from "./helpers.js";

const RANGES = {
  ...(JSON.parse(
    readFileSync(new URL("../../../configs/phase3-ranges.json", import.meta.url), "utf8"),
  ) as ParameterRanges),
  noise_sigma_rad_values: [degToRad(1)],
};
const SCEN: Scenario[] = Array.from(
  { length: 120 },
  (_, i) => generateScenario(31n, i, RANGES).scenario,
);

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

/** Range scaled by k (by scenario index parity, so the paired bootstrap has spread). */
const scaled =
  (k: number, dc = 0.05) =>
  (r: PredictionRow, i: number): PredictionRow => ({
    ...r,
    range_m: r.range_m * (k + (i % 3) * 0.01),
    course_rad: r.course_rad + dc * (1 + (i % 2)),
    speed_mps: r.speed_mps + 0.1,
  });

const mk = (label: string, f: (r: PredictionRow, i: number) => PredictionRow) =>
  set(
    label,
    SCEN.map((s) => perTimestep(s, label, f)),
  );

describe("G4 rows", () => {
  it("are σ = 1° turning scenarios at manoeuvre_index + 30 samples, never before the turn ends", () => {
    const rows = g4Rows(SCEN);
    expect(rows.length).toBeGreaterThan(60);
    for (const { s, k } of rows) {
      expect(s.metadata.manoeuvre_index).not.toBeUndefined();
      expect(k).toBe((s.metadata.manoeuvre_index ?? NaN) + 30);
    }
    expect(rows.length).toBe(SCEN.filter((s) => s.metadata.manoeuvre_index != null).length);
  });
});

describe("G4 checks", () => {
  it("pass: the network is better after the turn and passes the control", () => {
    const net = mk("lstm-instantaneous", scaled(1.05, 0.02));
    const ref = mk("imm", scaled(1.2, 0.1));
    const checks = g4Checks(SCEN, net, ref, 400);
    const v = g4Verdict(checks);
    expect(checks.map((c) => c.name)).toEqual([
      "g4-range",
      "g4-course",
      "g4-speed-reported",
      "g4-gross",
      "g4-control-range",
      "g4-control-course",
      "g4-control-speed",
    ]);
    expect(checks.find((c) => c.name === "g4-range")?.result).toBe("pass");
    expect(v.gate).toBe("G4");
    expect(v.result).toBe("pass");
  });

  it("fail: the reference is better after the turn", () => {
    const net = mk("lstm-instantaneous", scaled(1.2, 0.1));
    const ref = mk("imm", scaled(1.05, 0.02));
    expect(g4Verdict(g4Checks(SCEN, net, ref, 400)).result).toBe("fail");
  });

  it("fail: the network regresses on held-course scenarios (control)", () => {
    const f = scaled(1.05, 0.02);
    const net = set(
      "lstm-instantaneous",
      SCEN.map((s) =>
        perTimestep(s, "lstm-instantaneous", (r, i) =>
          s.metadata.manoeuvre_index == null ? { ...r, range_m: r.range_m * 1.5 } : f(r, i),
        ),
      ),
    );
    const checks = g4Checks(SCEN, net, mk("imm", scaled(1.2, 0.1)), 400);
    expect(checks.find((c) => c.name === "g4-control-range")?.result).toBe("fail");
    expect(g4Verdict(checks).result).toBe("fail");
  });

  it("speed is reported, never gated", () => {
    const checks = g4Checks(SCEN, mk("n", scaled(1.05, 0.02)), mk("r", scaled(1.2, 0.1)), 400).map(
      (c) => (c.name === "g4-speed-reported" ? { ...c, result: "fail" as const } : c),
    );
    expect(g4Verdict(checks).result).toBe("pass");
  });

  it("only rows at or after the turn's end are scored: pre-turn rows cannot help the network", () => {
    // The network is perfect before the turn and poor after it.
    const net = set(
      "n",
      SCEN.map((s) =>
        perTimestep(s, "n", (r, i) =>
          i < (s.metadata.manoeuvre_index ?? Infinity) ? r : { ...r, range_m: r.range_m * 1.3 },
        ),
      ),
    );
    const c = g4Checks(SCEN, net, mk("r", scaled(1.05, 0.02)), 400).find(
      (x) => x.name === "g4-range",
    );
    expect(c?.result).toBe("fail");
  });

  it("gross: wholly at or below 0 passes, as the Annex words it", () => {
    expect(judgeAtOrBelow(0, 0, 0, 0)).toBe("pass");
    expect(judgeAtOrBelow(-0.01, -0.02, 0.001, 0)).toBe("inconclusive");
    expect(judgeAtOrBelow(0.02, 0.01, 0.03, 0)).toBe("fail");
  });
});
