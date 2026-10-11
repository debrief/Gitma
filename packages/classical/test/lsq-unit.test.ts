import { describe, expect, it } from "vitest";
import { type BearingData, cost, normalEquations, solve4 } from "../src/lsq.js";
import { bearingData } from "../src/estimate.js";
import { NOISE_FREE, scenarios } from "./helpers.js";

describe("solve4", () => {
  it("solves a known system and rejects a singular one", () => {
    const a = Float64Array.from([4, 1, 0, 0, 1, 3, 1, 0, 0, 1, 2, 1, 0, 0, 1, 5]);
    const x = Float64Array.from([1, -2, 3, 0.5]);
    const b = Float64Array.from(
      [0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].reduce((s, c) => s + (a[4 * r + c] ?? 0) * (x[c] ?? 0), 0),
      ),
    );
    const got = solve4(a, b);
    expect(got).not.toBeNull();
    got?.forEach((v, i) => {
      expect(v).toBeCloseTo(x[i] ?? NaN, 12);
    });
    expect(solve4(new Float64Array(16), b)).toBeNull();
  });
});

describe("normal equations", () => {
  it("Jᵀr matches −½ ∂cost/∂θ by central differences", () => {
    const [s] = scenarios(5n, 1, NOISE_FREE);
    if (s === undefined) throw new Error();
    const d: BearingData = bearingData(s);
    const n = s.metadata.samples;
    const th = Float64Array.from([3000, 8000, 2, -4]);
    const { jtr } = normalEquations(d, th, n);
    const h = [1e-3, 1e-3, 1e-6, 1e-6];
    for (let k = 0; k < 4; k++) {
      const p = Float64Array.from(th);
      const m = Float64Array.from(th);
      p[k] = (p[k] ?? 0) + (h[k] ?? 0);
      m[k] = (m[k] ?? 0) - (h[k] ?? 0);
      const grad = (cost(d, p, n) - cost(d, m, n)) / (2 * (h[k] ?? 1));
      expect(jtr[k]).toBeCloseTo(-grad / 2, 6);
    }
  });
});
