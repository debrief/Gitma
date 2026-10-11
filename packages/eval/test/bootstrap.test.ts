import { createRng, uniform01 } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { bootstrapMedianRatio } from "../src/bootstrap.js";

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
