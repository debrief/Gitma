// Spec 018: G7's scoring on generated σ = 1° phase-4 scenarios, with synthetic predictions whose
// errors are drawn (seeded) from known Gaussians: recalibration, coverage, width, and the checks.
import { readFileSync } from "node:fs";
import { createRng, gaussian, generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import type { PredictionSet } from "../src/evaluate.js";
import { g5Rows } from "../src/gate-g5.js";
import { fitCalibration, g7Checks, g7Verdict, normalisedErrors } from "../src/gate-g7.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const ONE_DEG: ParameterRanges = { ...PHASE4, noise_sigma_rad_values: [Math.PI / 180] };
// Enough rows (about 17,000) that a coverage interval is narrower than the ±2 pp tolerance.
const scen: Scenario[] = Array.from(
  { length: 5000 },
  (_, i) => generateScenario(29n, i, ONE_DEG).scenario,
);

/**
 * A synthetic estimator: errors ~ N(0, trueSd) on log-range, course and speed, stating `stated`
 * (relative to trueSd: 1 = honest, 0.5 = overconfident).
 */
function synthetic(
  name: string,
  trueSd: [number, number, number],
  stated: number,
  seed: bigint,
): PredictionSet {
  const rng = createRng(seed);
  const byIndex = new Map<number, Prediction>();
  for (const s of scen) {
    const rows: PredictionRow[] = [];
    for (let k = s.metadata.zig_index + 1; k < s.metadata.samples; k++) {
      const t = s.target.states[k];
      const o = s.ownship.states[k];
      if (t === undefined || o === undefined) continue;
      const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
      rows.push({
        timestamp_s: k * s.metadata.parameters.dt_s,
        range_m: range * Math.exp(trueSd[0] * gaussian(rng)),
        course_rad: t.course_rad + trueSd[1] * gaussian(rng),
        speed_mps: t.speed_mps + trueSd[2] * gaussian(rng),
        x_m: 0,
        y_m: 0,
        converged: true,
        log_range_sd: trueSd[0] * stated,
        course_sd_rad: trueSd[1] * stated,
        speed_sd_mps: trueSd[2] * stated,
      });
    }
    byIndex.set(s.metadata.index, {
      record: "prediction",
      scenario_index: s.metadata.index,
      estimator: name,
      mode: "per_timestep",
      rows,
    });
  }
  return { label: name, estimator: name, byIndex };
}

describe("G7 scoring (spec 018)", () => {
  const rows = g5Rows(scen);
  const honest = synthetic("sharp", [0.05, 0.05, 0.3], 1, 1n);
  const wide = synthetic("wide", [0.1, 0.1, 0.6], 1, 2n);

  it("an honest Gaussian's multipliers are its quantiles: about 0.674 and 1.645", () => {
    const cal = fitCalibration(rows, honest);
    for (const c of cal) {
      expect(Math.abs(c.q50 - 0.674)).toBeLessThan(0.05);
      expect(Math.abs(c.q90 - 1.645)).toBeLessThan(0.08);
    }
    // An overconfident one (stating half its sd) gets multipliers about twice as large.
    const over = fitCalibration(rows, synthetic("over", [0.05, 0.05, 0.3], 0.5, 3n));
    for (const c of over) expect(Math.abs(c.q90 / 1.645 - 2)).toBeLessThan(0.15);
    // A row with no estimate is +∞.
    const missing = synthetic("m", [0.05, 0.05, 0.3], 1, 4n);
    for (const p of (missing.byIndex as unknown as Map<number, Prediction>).values())
      for (const r of p.rows) r.converged = false;
    expect(normalisedErrors(rows, missing, "speed").every((z) => z === Infinity)).toBe(true);
  });

  it("passes a calibrated, sharper tracker judged with multipliers fitted on other draws", () => {
    // Multipliers fitted on independent draws from the same process (out of sample).
    const fitT = fitCalibration(rows, synthetic("sharp", [0.05, 0.05, 0.3], 1, 11n));
    const fitR = fitCalibration(rows, synthetic("wide", [0.1, 0.1, 0.6], 1, 12n));
    const v = g7Verdict(g7Checks(scen, honest, wide, [...fitT, ...fitR], 200));
    expect(v.gate).toBe("G7");
    const gated = v.checks.filter((c) => !c.name.endsWith("-reported"));
    expect(gated).toHaveLength(9);
    expect(gated.map((c) => c.result)).toEqual(Array(9).fill("pass"));
    expect(v.result).toBe("pass");
  });

  it("fails a tracker whose test-time errors outgrow its validation multipliers, and a wider one", () => {
    const fitT = fitCalibration(rows, synthetic("sharp", [0.05, 0.05, 0.3], 1, 11n));
    const fitR = fitCalibration(rows, synthetic("wide", [0.1, 0.1, 0.6], 1, 12n));
    // At test the tracker's errors are 1.5 × larger than it states: undercoverage.
    const drifted = synthetic("sharp", [0.075, 0.075, 0.45], 2 / 3, 13n);
    const v = g7Verdict(g7Checks(scen, drifted, wide, [...fitT, ...fitR], 200));
    expect(v.checks.find((c) => c.name.endsWith("g7-coverage-course-90"))?.result).toBe("fail");
    expect(v.result).toBe("fail");
    // The wide estimator as the tracker against the sharp one: widths fail.
    const w = g7Verdict(g7Checks(scen, wide, honest, [...fitT, ...fitR], 200));
    expect(w.checks.find((c) => c.name.endsWith("g7-width-speed"))?.result).toBe("fail");
  });
});
