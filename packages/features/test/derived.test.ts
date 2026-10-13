// T032 (spec 003 US3, research R6): derived features — known values, causality, dropout and
// padding rows, the < 3-sample rule, and wrap across north.
import { DEFAULT_RANGES, generateScenario, TWO_PI } from "@tma/sim";
import type { NormalisationConstants, ParameterRanges, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  bearingLineIntercept,
  MIN_RATE_SAMPLES,
  RATE_WINDOW_ROWS,
  scenarioBearingRate,
  trailingBearingRate,
} from "../src/derived.js";
import { buildWindow, NI, NI_DERIVED, ROWS, WINDOW_MASK } from "../src/layout.js";
import { computeNormalisation } from "../src/normalise.js";

/** Iteration-2 noise: σ ∈ {1°, 2°} and a high dropout fraction, so dropout rows are common. */
const NOISY: ParameterRanges = {
  ...DEFAULT_RANGES,
  noise_sigma_rad_values: [Math.PI / 180, Math.PI / 90],
  dropout_fraction: { min: 0.2, max: 0.3 },
};

const times = (n: number): number[] => Array.from({ length: n }, (_, i) => 10 * i);
const all = (n: number, v = true): boolean[] => Array.from({ length: n }, () => v);
const wrap = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

describe("trailing least-squares bearing rate", () => {
  it("recovers a constant rate exactly, from the third sample on", () => {
    const n = 40;
    const w = 0.0013;
    const b = times(n).map((t) => 1 + w * t);
    const r = trailingBearingRate(times(n), b, all(n), n);
    expect([...r.valid.subarray(0, MIN_RATE_SAMPLES - 1)]).toEqual([0, 0]);
    for (let i = MIN_RATE_SAMPLES - 1; i < n; i++) {
      expect(r.valid[i]).toBe(1);
      expect(r.rate[i]).toBeCloseTo(w, 12);
    }
  });

  it("is not disturbed by crossing north (0/2π), in either direction", () => {
    const n = 30;
    for (const w of [0.004, -0.004]) {
      const start = w > 0 ? TWO_PI - 0.05 : 0.05;
      const b = times(n).map((t) => wrap(start + w * t));
      expect(b.some((x) => x < 1) && b.some((x) => x > 6)).toBe(true); // it does cross
      const r = trailingBearingRate(times(n), b, all(n), n);
      for (let i = 2; i < n; i++) expect(r.rate[i]).toBeCloseTo(w, 12);
    }
  });

  it("is a least-squares slope over the trailing window only", () => {
    // Bearing jumps by 0.5 rad at row 10; rows ≥ 10 + window see only the new level (rate 0).
    const n = 50;
    const b = times(n).map((_, i) => (i < 10 ? 0.2 : 0.7));
    const r = trailingBearingRate(times(n), b, all(n), n);
    expect(r.rate[10]).toBeGreaterThan(0);
    for (let i = 10 + RATE_WINDOW_ROWS - 1; i < n; i++) expect(r.rate[i]).toBe(0);
    // Hand LS slope at row 2 of (0, 0.2), (10, 0.2), (20, 0.7) after unwrapping: 0.025 rad/s.
    const h = trailingBearingRate([0, 10, 20], [0.2, 0.2, 0.7], all(3), 3);
    expect(h.rate[2]).toBeCloseTo(0.025, 14);
  });

  it("is causal: changing rows after t never changes rows ≤ t", () => {
    const n = 60;
    const b = times(n).map((t, i) => 2 + 0.001 * t + 0.01 * Math.sin(i * 1.7));
    const valid = times(n).map((_, i) => i % 7 !== 3);
    const base = trailingBearingRate(times(n), b, valid, n);
    for (const t of [0, 5, 17, 18, 33, 58]) {
      const b2 = b.map((x, i) => (i > t ? x + 1.234 : x));
      const v2 = valid.map((x, i) => (i > t ? !x : x));
      const r = trailingBearingRate(times(n), b2, v2, n);
      expect([...r.rate.subarray(0, t + 1)]).toEqual([...base.rate.subarray(0, t + 1)]);
      expect([...r.valid.subarray(0, t + 1)]).toEqual([...base.valid.subarray(0, t + 1)]);
    }
  });

  it("is zero, and not valid, on dropout rows and with fewer than 3 valid samples", () => {
    const n = 40;
    const b = times(n).map((t) => 0.5 + 0.002 * t);
    // Rows 0..19 have only rows 0 and 19 valid; row 20 then has 2 valid in its window (19, 20)
    // plus none older within 18 rows → invalid; row 21 has 3 (19, 20, 21) → valid.
    const valid = times(n).map((_, i) => i === 0 || i >= 19);
    const r = trailingBearingRate(times(n), b, valid, n);
    for (let i = 1; i < 19; i++) {
      expect(r.rate[i]).toBe(0);
      expect(r.valid[i]).toBe(0);
    }
    expect(r.valid[20]).toBe(0);
    expect(r.rate[20]).toBe(0);
    expect(r.valid[21]).toBe(1);
    expect(r.rate[21]).toBeCloseTo(0.002, 12);
  });
});

describe("bearing-line intercept (pseudo-linear measurement)", () => {
  it("hand case: x_o cos b − y_o sin b", () => {
    const b = Math.PI / 6; // 30°
    expect(bearingLineIntercept(1000, 2000, b)).toBeCloseTo(
      1000 * Math.cos(b) - 2000 * Math.sin(b),
      9,
    );
    expect(bearingLineIntercept(1000, 2000, b)).toBeCloseTo(-133.97459621556135, 9);
    // Due north (b = 0) the line is x = x_o; due east (b = π/2) it is y = y_o (intercept −y_o).
    expect(bearingLineIntercept(1500, -700, 0)).toBe(1500);
    expect(bearingLineIntercept(1500, -700, Math.PI / 2)).toBeCloseTo(700, 9);
  });

  it("every point on the bearing line has the same intercept (frame: x east, y north)", () => {
    const own = { x: 3200, y: -4100 };
    for (const b of [0.3, 1.9, 3.5, 5.8]) {
      const c = bearingLineIntercept(own.x, own.y, b);
      for (const r of [500, 4000, 25000]) {
        const tx = own.x + r * Math.sin(b);
        const ty = own.y + r * Math.cos(b);
        expect(bearingLineIntercept(tx, ty, b)).toBeCloseTo(c, 6);
      }
    }
  });
});

describe("derived feature set in buildWindow", () => {
  const scenarios = Array.from({ length: 30 }, (_, i) => generateScenario(31n, i, NOISY).scenario);
  const norm = computeNormalisation(scenarios, "d", "derived");

  it("appends rate, rate_valid and intercept after the raw channels, which are unchanged", () => {
    for (const s of scenarios.slice(0, 5)) {
      const raw = buildWindow(s, norm, "raw");
      const der = buildWindow(s, norm, "derived");
      expect(der.inputs).toHaveLength(ROWS * NI_DERIVED);
      expect(der.targets).toEqual(raw.targets);
      expect(der.lossMask).toEqual(raw.lossMask);
      const rate = scenarioBearingRate(s);
      for (let i = 0; i < ROWS; i++) {
        const d = der.inputs.subarray(i * NI_DERIVED, (i + 1) * NI_DERIVED);
        expect([...d.subarray(0, NI)]).toEqual([...raw.inputs.subarray(i * NI, (i + 1) * NI)]);
        const z = s.observations[i];
        const o = s.ownship.states[i];
        if (i >= s.metadata.samples || z === undefined || o === undefined) {
          expect([...d]).toEqual(new Array(NI_DERIVED).fill(0)); // padding
          continue;
        }
        expect(d[WINDOW_MASK]).toBe(1);
        if (!z.valid) {
          expect([d[NI], d[NI + 1], d[NI + 2]]).toEqual([0, 0, 0]); // dropout
          continue;
        }
        expect(d[NI + 1]).toBe(rate.valid[i]);
        expect(d[NI]).toBe(
          Math.fround((rate.rate[i] ?? 0) / (norm.bearing_rate_scale_rad_s ?? NaN)),
        );
        expect(d[NI + 2]).toBe(
          Math.fround(
            bearingLineIntercept(o.x_m, o.y_m, z.bearing_rad) / 1000 / norm.position_scale_km,
          ),
        );
      }
    }
    // The data really contain dropouts and valid rates.
    const flat = scenarios.flatMap((s) => s.observations.map((o) => o.valid));
    expect(flat.filter((v) => !v).length).toBeGreaterThan(100);
  });

  it("is causal: perturbing observations after row t leaves rows ≤ t unchanged", () => {
    const s = scenarios[3] as Scenario;
    const base = buildWindow(s, norm, "derived");
    for (const t of [0, 10, 40, s.metadata.samples - 2]) {
      const altered: Scenario = {
        ...s,
        observations: s.observations.map((z, i) =>
          i > t ? { ...z, bearing_rad: wrap(z.bearing_rad + 0.9), valid: !z.valid } : z,
        ),
      };
      const w = buildWindow(altered, norm, "derived");
      const upTo = (t + 1) * NI_DERIVED;
      const bytes = (a: Float32Array): Buffer => Buffer.from(a.buffer, a.byteOffset, upTo * 4);
      expect(bytes(w.inputs).equals(bytes(base.inputs))).toBe(true);
      expect(w.inputs.subarray(upTo)).not.toEqual(base.inputs.subarray(upTo));
    }
  });

  it("refuses a norm without bearing_rate_scale_rad_s", () => {
    const rawNorm = { ...norm, bearing_rate_scale_rad_s: undefined };
    const s = scenarios[0] as Scenario;
    expect(() => buildWindow(s, rawNorm as NormalisationConstants, "derived")).toThrow(
      /bearing_rate_scale_rad_s/,
    );
    expect(() => buildWindow(s, rawNorm as NormalisationConstants, "raw")).not.toThrow();
  });
});
