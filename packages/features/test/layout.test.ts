import { DEFAULT_RANGES, generateScenario, noiseFree } from "@tma/sim";
import type { NormalisationConstants, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { buildWindow, NI, NT, ROWS } from "../src/layout.js";

const norm: NormalisationConstants = {
  position_scale_km: 10,
  speed_scale_mps: 8,
  time_scale_s: 2400,
  computed_from: "inputs_only",
  train_header_digest: "x",
};

function scenario(): Scenario {
  const s = structuredClone(generateScenario(3n, 0, noiseFree(DEFAULT_RANGES)).scenario);
  const o = s.observations[5];
  if (o === undefined) throw new Error();
  o.valid = false;
  o.bearing_rad = 0;
  const first = s.observations[0];
  if (first === undefined) throw new Error();
  first.bearing_rad = 0; // due north: sin 0, cos 1
  return s;
}

describe("feature layout (SRD §4)", () => {
  const s = scenario();
  const w = buildWindow(s, norm);
  const n = s.metadata.samples;
  const at = (row: number, ch: number) => w.inputs[row * NI + ch];

  it("pads to 240 rows with a window mask", () => {
    expect(w.inputs).toHaveLength(ROWS * NI);
    expect(w.targets).toHaveLength(ROWS * NT);
    expect(at(0, 9)).toBe(1);
    expect(at(n - 1, 9)).toBe(1);
    if (n < ROWS) {
      expect(at(n, 9)).toBe(0);
      expect([...w.inputs.subarray(n * NI)].every((v) => v === 0)).toBe(true);
    }
  });

  it("encodes bearing as sin/cos and zeroes dropouts with valid = 0", () => {
    expect(at(0, 0)).toBe(0);
    expect(at(0, 1)).toBe(1);
    expect(at(0, 8)).toBe(1);
    expect([at(5, 0), at(5, 1), at(5, 8)]).toEqual([0, 0, 0]);
    expect(at(5, 9)).toBe(1); // still inside the window
  });

  it("scales ownship position, speed and time by the constants", () => {
    const o = s.ownship.states[20];
    if (o === undefined) throw new Error();
    expect(at(20, 2)).toBeCloseTo(o.x_m / 1000 / 10, 6);
    expect(at(20, 3)).toBeCloseTo(o.y_m / 1000 / 10, 6);
    expect(at(20, 6)).toBeCloseTo(o.speed_mps / 8, 6);
    expect(at(20, 7)).toBeCloseTo(o.timestamp_s / 2400, 6);
  });

  it("targets hold ln range (km), course vector, scaled speed, position (km)", () => {
    const o = s.ownship.states[10];
    const t = s.target.states[10];
    if (o === undefined || t === undefined) throw new Error();
    const r = (k: number) => w.targets[10 * NT + k];
    expect(r(0)).toBeCloseTo(Math.log(Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m) / 1000), 5);
    expect(r(1)).toBeCloseTo(Math.sin(t.course_rad), 6);
    expect(r(2)).toBeCloseTo(Math.cos(t.course_rad), 6);
    expect(r(3)).toBeCloseTo(t.speed_mps / 8, 6);
    expect(r(4)).toBeCloseTo(t.x_m / 1000, 5);
  });

  it("loss mask covers rows after the zig, inside the window", () => {
    const k = s.metadata.zig_index;
    expect(w.lossMask[k]).toBe(0);
    expect(w.lossMask[k + 1]).toBe(1);
    expect(w.lossMask[n - 1]).toBe(1);
    expect([...w.lossMask].reduce((a, b) => a + b, 0)).toBe(n - k - 1);
  });
});
