import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import type { Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { buildWindow } from "../src/layout.js";
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

  it("model inputs are byte-identical when target truth and drawn parameters change", () => {
    // Counterfactual (round-1 panel review): the shuffled-label check cannot see a truth channel
    // in the inputs, so assert directly that inputs depend only on observations, ownship and time.
    for (let i = 0; i < 50; i++) {
      const s = generateScenario(23n, i, DEFAULT_RANGES).scenario;
      const norm = computeNormalisation([s], "d");
      const p = s.metadata.parameters;
      const altered: Scenario = {
        ...s,
        target: {
          ...s.target,
          states: s.target.states.map((t) => ({
            ...t,
            x_m: t.x_m + 12345,
            y_m: -t.y_m,
            course_rad: (t.course_rad + 1) % (2 * Math.PI),
            speed_mps: t.speed_mps * 2,
          })),
        },
        metadata: {
          ...s.metadata,
          parameters: {
            ...p,
            target_range0_m: p.target_range0_m * 3,
            target_bearing0_rad: (p.target_bearing0_rad + 2) % (2 * Math.PI),
            target_speed_mps: p.target_speed_mps + 5,
            target_course_rad: (p.target_course_rad + 1) % (2 * Math.PI),
          },
        },
      };
      const a = buildWindow(s, norm);
      const b = buildWindow(altered, norm);
      expect(Buffer.from(b.inputs.buffer)).toEqual(Buffer.from(a.inputs.buffer));
      expect(Buffer.from(b.targets.buffer)).not.toEqual(Buffer.from(a.targets.buffer));
    }
  });
});
