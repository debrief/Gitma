import { describe, expect, it } from "vitest";
import { dropoutBand, sliceKeys } from "../src/slices.js";
import { scenarios } from "./helpers.js";

describe("slices", () => {
  it("assigns overall, range, zig and σ slices", () => {
    for (const s of scenarios(3n, 200)) {
      const k = sliceKeys(s.metadata);
      expect(k[0]).toBe("overall");
      expect(k[1]).toMatch(/^range_band=(0-2|2-5|5-10|10-20|20-30|30\+)km$/);
      expect(k[2]).toMatch(/^zig_band=(30-50|50-70|70-90)deg$/);
      expect(k[3]).toMatch(/^sigma=(0\.5|1|2)deg$/);
      expect(k[4]).toMatch(/^dropout_band=(0-5|5-10)pct$/);
    }
  });

  it("puts boundary values in the upper band and 90° in 70-90", () => {
    const [s] = scenarios(4n, 1);
    if (s === undefined) throw new Error();
    const m = {
      ...s.metadata,
      mean_range_m: 5000,
      parameters: { ...s.metadata.parameters, zig_angle_rad: -Math.PI / 2 },
    };
    expect(sliceKeys(m).slice(1, 3)).toEqual(["range_band=5-10km", "zig_band=70-90deg"]);
  });

  it("iteration-3 turns beyond 90° get their own bands up to 180° (spec 007)", () => {
    const [s] = scenarios(4n, 1);
    if (s === undefined) throw new Error();
    const zig = (deg: number) =>
      sliceKeys({
        ...s.metadata,
        parameters: { ...s.metadata.parameters, zig_angle_rad: (deg * Math.PI) / 180 },
      })[2];
    expect(zig(100)).toBe("zig_band=90-120deg");
    expect(zig(-143)).toBe("zig_band=120-150deg");
    expect(zig(179.9)).toBe("zig_band=150-180deg");
    expect(zig(180.0004)).toBe("zig_band=150-180deg");
    expect(zig(29.9995)).toBe("zig_band=30-50deg");
  });

  it("dropout band: 3% → 0-5pct, 7% → 5-10pct, boundary 5% → upper band (T021)", () => {
    const [s] = scenarios(5n, 1);
    if (s === undefined) throw new Error();
    const key = (f: number) =>
      sliceKeys({
        ...s.metadata,
        parameters: { ...s.metadata.parameters, dropout_fraction: f },
      })[4];
    expect(key(0.03)).toBe("dropout_band=0-5pct");
    expect(key(0.07)).toBe("dropout_band=5-10pct");
    expect(key(0.05)).toBe("dropout_band=5-10pct");
    expect(key(Math.fround(0.05))).toBe("dropout_band=5-10pct");
    expect(key(0)).toBe("dropout_band=0-5pct");
    // Drawn in [0, 0.10]: float32 0.1 lies just above 10% and stays in the top band.
    expect(dropoutBand(Math.fround(0.1))).toBe("5-10pct");
  });
});
