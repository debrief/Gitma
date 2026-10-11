import { DEFAULT_RANGES, degToRad } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { classicalPredict } from "../src/estimate.js";
import { median, scenarios, truthAt } from "./helpers.js";

describe("noisy behaviour", () => {
  const medianRangeError = (sigmaDeg: number): number => {
    const ranges = { ...DEFAULT_RANGES, noise_sigma_rad_values: [degToRad(sigmaDeg)] };
    const errs: number[] = [];
    for (const s of scenarios(11n, 150, ranges)) {
      const row = classicalPredict(s, "final").rows[0];
      if (row === undefined) throw new Error("no row");
      // Never a silent wrong answer: every row is finite or flagged non-converged.
      const finite = [row.range_m, row.course_rad, row.speed_mps, row.x_m, row.y_m].every(
        Number.isFinite,
      );
      expect(finite || !row.converged).toBe(true);
      const tr = truthAt(s, s.metadata.samples - 1);
      errs.push(Math.abs(row.range_m - tr.range) / tr.range);
    }
    return median(errs);
  };

  it("median range error grows with σ", () => {
    const e = [0.5, 1, 2].map(medianRangeError);
    expect(e[0]).toBeLessThan(e[1] ?? 0);
    expect(e[1]).toBeLessThan(e[2] ?? 0);
  });
});
