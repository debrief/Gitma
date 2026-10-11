import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import type { Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { computeNormalisation } from "../src/normalise.js";

describe("normalisation leakage (constitution IV)", () => {
  it("constants are identical when target truth is shuffled across scenarios", () => {
    const train = Array.from(
      { length: 200 },
      (_, i) => generateScenario(21n, i, DEFAULT_RANGES).scenario,
    );
    // Rotate target tracks by one scenario and scale target speeds: labels change, inputs do not.
    const shuffled: Scenario[] = train.map((s, i) => {
      const donor = train[(i + 1) % train.length];
      if (donor === undefined) throw new Error();
      const target = {
        ...donor.target,
        states: donor.target.states.map((t) => ({ ...t, speed_mps: t.speed_mps * 3 })),
      };
      return { ...s, target };
    });
    expect(computeNormalisation(shuffled, "d")).toEqual(computeNormalisation(train, "d"));
  });

  it("records that it used inputs only", () => {
    const train = [generateScenario(21n, 0, DEFAULT_RANGES).scenario];
    expect(computeNormalisation(train, "d").computed_from).toBe("inputs_only");
  });
});
