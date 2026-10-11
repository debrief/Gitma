import { describe, expect, it } from "vitest";
import { sliceKeys } from "../src/slices.js";
import { scenarios } from "./helpers.js";

describe("slices", () => {
  it("assigns overall, range, zig and σ slices", () => {
    for (const s of scenarios(3n, 200)) {
      const k = sliceKeys(s.metadata);
      expect(k[0]).toBe("overall");
      expect(k[1]).toMatch(/^range_band=(0-2|2-5|5-10|10-20|20-30|30\+)km$/);
      expect(k[2]).toMatch(/^zig_band=(30-50|50-70|70-90)deg$/);
      expect(k[3]).toMatch(/^sigma=(0\.5|1|2)deg$/);
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
});
