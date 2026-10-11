import { describe, expect, it } from "vitest";
import { makeDataset } from "./helpers.js";

describe("throughput (FR-005, SC-002)", () => {
  it("generates and writes ≥ 1,000 scenarios/s single-threaded (f32pack)", () => {
    const count = 5000;
    const t0 = performance.now();
    makeDataset(5n, count, "f32pack");
    const total = count + Math.floor(count / 10);
    const rate = total / ((performance.now() - t0) / 1000);
    expect(rate).toBeGreaterThanOrEqual(1000);
  });
});
