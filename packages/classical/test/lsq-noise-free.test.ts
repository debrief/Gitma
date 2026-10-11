import { angleDiff, mpsToKt, radToDeg } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { classicalPredict } from "../src/estimate.js";
import { NOISE_FREE, scenarios, truthAt } from "./helpers.js";

describe("noise-free recovery (SC-001, G0 check 1)", () => {
  it("recovers truth within 0.1% range, 0.1° course, 0.01 kt speed on 500 scenarios", () => {
    const failures: string[] = [];
    for (const s of scenarios(42n, 500, NOISE_FREE)) {
      const row = classicalPredict(s, "final").rows[0];
      if (row === undefined) throw new Error("no row");
      const tr = truthAt(s, s.metadata.samples - 1);
      const er = Math.abs(row.range_m - tr.range) / tr.range;
      const ec = Math.abs(radToDeg(angleDiff(row.course_rad, tr.course)));
      const es = Math.abs(mpsToKt(row.speed_mps - tr.speed));
      if (!row.converged || er > 1e-3 || ec > 0.1 || es > 0.01) {
        failures.push(
          `#${String(s.metadata.index)} range ${er.toExponential(2)} course ${ec.toFixed(4)}° speed ${es.toFixed(4)} kt`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});
