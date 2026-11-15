// Spec 025: G9 for the composite solver (gate-g9.ts).
import { readFileSync } from "node:fs";
import { degToRad, generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { g5Rows } from "../src/gate-g5.js";
import { G9_GATED, g9Checks, g9Verdict, straightRow } from "../src/gate-g9.js";
import { set, truthRow } from "./helpers.js";

const RANGES = {
  ...(JSON.parse(
    readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
  ) as ParameterRanges),
  noise_sigma_rad_values: [degToRad(1)],
};
const SCEN: Scenario[] = Array.from(
  { length: 80 },
  (_, i) => generateScenario(43n, i, RANGES).scenario,
);

/** Per-timestep rows: truth with errors scaled by `straight` on straight legs, `other` elsewhere. */
function mk(label: string, straight: number, other: number) {
  const straightAt = new Map<Scenario, Set<number>>();
  for (const r of g5Rows(SCEN))
    if (straightRow(r)) {
      const s = straightAt.get(r.s) ?? new Set<number>();
      s.add(r.k);
      straightAt.set(r.s, s);
    }
  return set(
    label,
    SCEN.map((s): Prediction => {
      const rows: PredictionRow[] = [];
      for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
        const t = truthRow(s, i);
        const f = straightAt.get(s)?.has(i) ? straight : other;
        rows.push({
          ...t,
          range_m: t.range_m * (1 + 0.1 * f * (1 + (i % 3) * 0.2)),
          course_rad: t.course_rad + 0.05 * f * (1 + (i % 2)),
          speed_mps: t.speed_mps + 0.2 * f * (1 + (i % 2) * 0.5),
        });
      }
      return {
        record: "prediction",
        scenario_index: s.metadata.index,
        estimator: label,
        mode: "per_timestep",
        rows,
      };
    }),
  );
}

describe("G9", () => {
  it("straight-leg rows are settled rows before any manoeuvre has started", () => {
    const rows = g5Rows(SCEN);
    const straight = rows.filter(straightRow);
    expect(straight.length).toBeGreaterThan(0);
    for (const r of straight) {
      expect(r.settled).toBe(true);
      for (const m of r.s.metadata.manoeuvres ?? []) expect(m.start_index).toBeGreaterThan(r.k);
    }
  });

  it("passes the best of both: LSQ on straight legs, better than fused elsewhere", () => {
    const lsq = mk("classical", 1, 4);
    const fused = mk("fused", 2, 2);
    const comp = mk("composite", 1, 1);
    const checks = g9Checks(SCEN, comp, fused, lsq, 200, 5n);
    for (const g of G9_GATED) expect(checks.some((c) => c.name === g)).toBe(true);
    expect(g9Verdict(checks).result).toBe("pass");
    expect(g9Verdict(checks).gate).toBe("G9");
  });

  it("fails when the composite loses least squares' accuracy on straight legs", () => {
    const lsq = mk("classical", 1, 4);
    const fused = mk("fused", 2, 2);
    const comp = mk("composite", 2, 1); // the fused tracker's straight-leg error
    const v = g9Verdict(g9Checks(SCEN, comp, fused, lsq, 200, 5n));
    expect(v.result).toBe("fail");
    expect(v.checks.find((c) => c.name === "g9-straight-range")?.result).toBe("fail");
  });

  it("fails when the composite is no better than the fused tracker overall", () => {
    const lsq = mk("classical", 1, 4);
    const fused = mk("fused", 2, 2);
    const comp = mk("composite", 1, 3);
    const v = g9Verdict(g9Checks(SCEN, comp, fused, lsq, 200, 5n));
    expect(v.result).toBe("fail");
    expect(v.checks.find((c) => c.name === "g9-range-vs-fused")?.result).toBe("fail");
  });
});
