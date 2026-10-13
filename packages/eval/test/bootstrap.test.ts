import { createRng, uniform01 } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { bootstrapMedian, bootstrapMedianRatio, selectMedian } from "../src/bootstrap.js";
import { ascending, median } from "../src/stats.js";

const sample = (seed: bigint, n: number): Float64Array => {
  const r = createRng(seed);
  return Float64Array.from({ length: n }, () => uniform01(r));
};

describe("paired bootstrap of a median ratio", () => {
  it("an exact multiple gives that ratio with a zero-width interval (pairing)", () => {
    const b = sample(1n, 2000);
    const a = b.map((x) => 0.3 * x);
    const ci = bootstrapMedianRatio(a, b, 200);
    expect(ci.ratio).toBeCloseTo(0.3, 12);
    expect(ci.lo).toBeCloseTo(0.3, 12);
    expect(ci.hi).toBeCloseTo(0.3, 12);
  });

  it("the interval brackets the point estimate and narrows with n", () => {
    const small = bootstrapMedianRatio(sample(2n, 400), sample(3n, 400), 500);
    const large = bootstrapMedianRatio(sample(4n, 10000), sample(5n, 10000), 500);
    for (const ci of [small, large]) {
      expect(ci.lo).toBeLessThanOrEqual(ci.ratio);
      expect(ci.hi).toBeGreaterThanOrEqual(ci.ratio);
      expect(Math.abs(ci.ratio - 1)).toBeLessThan(0.15);
    }
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("is deterministic for a given seed", () => {
    const a = sample(6n, 500);
    const b = sample(7n, 500);
    expect(bootstrapMedianRatio(a, b, 100)).toEqual(bootstrapMedianRatio(a, b, 100));
  });

  it("rejects unequal or empty samples", () => {
    expect(() => bootstrapMedianRatio(new Float64Array(0), new Float64Array(0))).toThrow();
    expect(() => bootstrapMedianRatio(sample(8n, 3), sample(9n, 4))).toThrow();
  });
});

describe("bootstrap interval of a single median (T023)", () => {
  it("selection gives the same nearest-rank median as sorting", () => {
    const r = createRng(10n);
    for (const n of [1, 2, 3, 10, 101, 1000]) {
      const xs = Float64Array.from({ length: n }, () => Math.floor(uniform01(r) * 20));
      xs[0] = Infinity;
      expect(selectMedian(Float64Array.from(xs))).toBe(median(ascending(Array.from(xs))));
    }
  });

  it("is deterministic for a given seed and changes with the seed", () => {
    const x = sample(11n, 500);
    expect(bootstrapMedian(x, 200, 5n)).toEqual(bootstrapMedian(x, 200, 5n));
    expect(bootstrapMedian(x, 200, 6n)).not.toEqual(bootstrapMedian(x, 200, 5n));
  });

  it("brackets the sample median; NaN and non-converged (+∞) rank worst", () => {
    const x = sample(12n, 400);
    const ci = bootstrapMedian(x, 300);
    expect(ci.lo).toBeLessThanOrEqual(ci.median);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.median);
    const bad = Float64Array.from({ length: 10 }, (_, i) => (i < 6 ? NaN : 1));
    expect(bootstrapMedian(bad, 50).median).toBe(Infinity);
    expect(() => bootstrapMedian(new Float64Array(0))).toThrow();
  });

  it("covers the true median in ≈ 95% of 200 synthetic draws", () => {
    // Exponential(1), heavy-ish tail like range errors: true median ln 2.
    const r = createRng(13n);
    let covered = 0;
    for (let k = 0; k < 200; k++) {
      const x = Float64Array.from({ length: 301 }, () => -Math.log(1 - uniform01(r)));
      const ci = bootstrapMedian(x, 400, BigInt(100 + k));
      if (ci.lo <= Math.LN2 && Math.LN2 <= ci.hi) covered++;
    }
    expect(covered / 200).toBeGreaterThanOrEqual(0.89);
    expect(covered / 200).toBeLessThanOrEqual(0.99);
  });
});
