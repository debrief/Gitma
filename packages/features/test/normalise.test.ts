// T033 (spec 003 US3, FR-009): the derived set's constant is computed from inputs only, and the
// derived inputs do not change when target truth is scrambled (counterfactual).
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import type { ParameterRanges, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { rateQuantile, scenarioBearingRate } from "../src/derived.js";
import { buildWindow } from "../src/layout.js";
import { computeNormalisation } from "../src/normalise.js";

const NOISY: ParameterRanges = {
  ...DEFAULT_RANGES,
  noise_sigma_rad_values: [Math.PI / 180, Math.PI / 90],
  dropout_fraction: { min: 0, max: 0.1 },
};

const train = Array.from({ length: 150 }, (_, i) => generateScenario(41n, i, NOISY).scenario);

/** Target truth and drawn target parameters replaced; observations, ownship and time kept. */
function scramble(ss: Scenario[]): Scenario[] {
  return ss.map((s, i) => {
    const donor = ss[(i + 7) % ss.length] as Scenario;
    const p = s.metadata.parameters;
    return {
      ...s,
      target: {
        ...donor.target,
        states: s.target.states.map((t, k) => {
          const d = donor.target.states[k] ?? t;
          return {
            ...d,
            timestamp_s: t.timestamp_s,
            x_m: d.x_m * 3 + 999,
            speed_mps: 2 * d.speed_mps,
          };
        }),
      },
      metadata: {
        ...s.metadata,
        mean_range_m: s.metadata.mean_range_m * 5,
        parameters: {
          ...p,
          target_range0_m: p.target_range0_m * 2,
          target_speed_mps: p.target_speed_mps + 3,
          target_course_rad: (p.target_course_rad + 2) % (2 * Math.PI),
        },
      },
    };
  });
}

describe("derived normalisation (inputs only)", () => {
  const norm = computeNormalisation(train, "d", "derived");

  it("adds bearing_rate_scale_rad_s: the P90 of |rate| over valid-rate train rows", () => {
    const abs = train.flatMap((s) => {
      const r = scenarioBearingRate(s);
      return [...r.rate].filter((_, i) => r.valid[i] === 1).map((v) => Math.fround(Math.abs(v)));
    });
    expect(abs.length).toBeGreaterThan(1000);
    const sorted = [...abs].sort((a, b) => a - b);
    expect(norm.bearing_rate_scale_rad_s).toBe(sorted[Math.ceil(0.9 * sorted.length) - 1]);
    expect(norm.bearing_rate_scale_rad_s).toBe(rateQuantile(Float32Array.from(abs)));
    // Plausible: true rates are ≈ 0.005–0.3°/s (research R6); noise adds a little.
    const deg = (norm.bearing_rate_scale_rad_s ?? 0) * (180 / Math.PI);
    expect(deg).toBeGreaterThan(0.01);
    expect(deg).toBeLessThan(1);
    expect(norm.computed_from).toBe("inputs_only");
  });

  it("raw normalisation is unchanged by the derived set (no extra constant)", () => {
    const raw = computeNormalisation(train, "d");
    expect(raw.bearing_rate_scale_rad_s).toBeUndefined();
    const rest = Object.fromEntries(
      Object.entries(norm).filter(([k]) => k !== "bearing_rate_scale_rad_s"),
    );
    expect(rest).toEqual(raw);
  });

  it("the constant is identical when target truth is scrambled", () => {
    expect(computeNormalisation(scramble(train), "d", "derived")).toEqual(norm);
  });

  it("derived inputs are byte-identical under scrambled truth; targets are not", () => {
    const alt = scramble(train);
    for (let i = 0; i < 40; i++) {
      const a = buildWindow(train[i] as Scenario, norm, "derived");
      const b = buildWindow(alt[i] as Scenario, norm, "derived");
      expect(Buffer.from(b.inputs.buffer).equals(Buffer.from(a.inputs.buffer))).toBe(true);
      expect(Buffer.from(b.targets.buffer).equals(Buffer.from(a.targets.buffer))).toBe(false);
    }
  });
});
