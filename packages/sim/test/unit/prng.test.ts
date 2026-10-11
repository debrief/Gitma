import { describe, expect, it } from "vitest";
import {
  createRng,
  deriveSeed,
  gaussian,
  nextU32,
  parseSeed,
  splitmix64,
  uniform01,
} from "../../src/prng.js";

describe("splitmix64", () => {
  it("matches the published reference vector for seed 1234567", () => {
    expect(splitmix64(1234567n, 5)).toEqual([
      6457827717110365317n,
      3203168211198807973n,
      9817491932198370423n,
      4593380528125082431n,
      16408922859458223821n,
    ]);
  });

  it("deriveSeed(seed, i) is the i-th output", () => {
    expect(deriveSeed(1234567n, 2)).toBe(9817491932198370423n);
  });
});

describe("xoshiro128**", () => {
  // Vectors from an independent Python port of the reference C (cross-language check).
  it.each([
    [1234567n, [1967786208, 270031234, 1115494691, 824886977, 1639868524, 2161081248]],
    [0n, [3737715805, 2584255861, 2876756834]],
    [2n ** 64n - 1n, [477689756, 2493998634, 555695776]],
  ])("seed %s", (seed, expected) => {
    const s = createRng(seed);
    expect(expected.map(() => nextU32(s))).toEqual(expected);
  });
});

describe("distributions", () => {
  it("uniform01 lies in [0, 1) with mean ≈ 0.5", () => {
    const s = createRng(42n);
    let sum = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < 100_000; i++) {
      const u = uniform01(s);
      sum += u;
      min = Math.min(min, u);
      max = Math.max(max, u);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it("gaussian has mean ≈ 0 and variance ≈ 1", () => {
    const s = createRng(7n);
    const n = 100_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const g = gaussian(s);
      sum += g;
      sq += g * g;
    }
    expect(sum / n).toBeCloseTo(0, 1);
    expect(sq / n).toBeCloseTo(1, 1);
  });
});

describe("parseSeed", () => {
  it("accepts uint64 decimal strings and rejects others", () => {
    expect(parseSeed("18446744073709551615")).toBe(2n ** 64n - 1n);
    expect(() => parseSeed("18446744073709551616")).toThrow();
    expect(() => parseSeed("-1")).toThrow();
    expect(() => parseSeed("1e3")).toThrow();
  });
});
