import { DEFAULT_RANGES } from "@tma/sim";
import type { Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { classicalPredict } from "../src/estimate.js";
import { scenarios } from "./helpers.js";

describe("per-timestep mode is causal", () => {
  it("perturbing bearings after sample j leaves rows up to j unchanged", () => {
    const [s] = scenarios(8n, 1, DEFAULT_RANGES);
    if (s === undefined) throw new Error();
    const j = s.metadata.zig_index + 20;
    const perturbed: Scenario = structuredClone(s);
    perturbed.observations.forEach((o, i) => {
      if (i > j && o.valid) o.bearing_rad = (o.bearing_rad + 0.3) % (2 * Math.PI);
    });
    const a = classicalPredict(s, "per_timestep").rows;
    const b = classicalPredict(perturbed, "per_timestep").rows;
    const upToJ = (rows: typeof a) =>
      rows.filter((r) => r.timestamp_s <= j * s.metadata.parameters.dt_s);
    expect(upToJ(a).length).toBe(20);
    expect(upToJ(b)).toEqual(upToJ(a));
    expect(b.at(-1)).not.toEqual(a.at(-1));
  });

  it("emits one row per sample from zig_index + 1", () => {
    const [s] = scenarios(9n, 1, DEFAULT_RANGES);
    if (s === undefined) throw new Error();
    const rows = classicalPredict(s, "per_timestep").rows;
    expect(rows).toHaveLength(s.metadata.samples - s.metadata.zig_index - 1);
  });
});

describe("per-timestep robustness", () => {
  it("never reports an implausible solution as converged (noisy data, 30 scenarios)", async () => {
    const { PLAUSIBLE } = await import("../src/estimate.js");
    const bad: string[] = [];
    for (const s of scenarios(7n, 30, DEFAULT_RANGES)) {
      for (const r of classicalPredict(s, "per_timestep").rows) {
        if (
          r.converged &&
          (r.speed_mps > PLAUSIBLE.maxSpeedMps || r.range_m > PLAUSIBLE.maxRangeM)
        ) {
          bad.push(`#${String(s.metadata.index)} t=${String(r.timestamp_s)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 30_000);
});
