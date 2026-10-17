// @tma/demos core (spec 006): geometry, URL state, scenario regeneration, estimates and errors.
import { canonicalJson } from "@tma/data";
import { generateScenario, parseSeed } from "@tma/sim";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  clampIndex,
  classicalRows,
  decodeView,
  encodeView,
  formatDistance,
  gridLines,
  gridStep,
  legsOf,
  naiveRows,
  rowAtSample,
  sampleAt,
  scenarioAt,
  scenarioErrors,
  seriesOf,
  type ViewerCatalogue,
  viewNdjson,
} from "../src/index.js";
import { I1_TEST, I2_TEST, ranges } from "./helpers.js";

const MEANS = { log_range_km: 2, course_sin: 0, course_cos: 1, speed_mps: 5.9, n: 1 };

describe("geometry", () => {
  it("picks 1–2–5 grid steps between 100 m and 10 km", () => {
    expect(gridStep(8000)).toBe(1000);
    expect(gridStep(16000)).toBe(2000);
    expect(gridStep(40000)).toBe(5000);
    expect(gridStep(10)).toBe(100);
    expect(gridStep(1e7)).toBe(10000);
    expect(gridLines(-2500, 2500, 1000)).toEqual([-2000, -1000, 0, 1000, 2000]);
  });
  it("bounds are square, centred and at least the minimum span", () => {
    const b = boundsOf([
      [0, 0],
      [10000, 2000],
    ]);
    expect(b.maxX - b.minX).toBeCloseTo(b.maxY - b.minY);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(5000);
    expect(b.maxX - b.minX).toBeGreaterThan(10000);
    expect(boundsOf([]).maxX - boundsOf([]).minX).toBe(2000);
  });
  it("formats distances", () => {
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(2000)).toBe("2 km");
    expect(formatDistance(1500)).toBe("1.5 km");
  });
});

describe("scenarios", () => {
  it("regenerates the pipeline's scenario byte for byte and refuses indices outside the split", () => {
    const s = scenarioAt(I2_TEST, 90007);
    const node = generateScenario(parseSeed("201"), 90007, I2_TEST.ranges).scenario;
    expect(canonicalJson(s)).toBe(canonicalJson(node));
    expect(() => scenarioAt(I2_TEST, 89999)).toThrow(RangeError);
    expect(() => scenarioAt(I2_TEST, 100000)).toThrow(RangeError);
    expect(clampIndex(I2_TEST, 5)).toBe(90000);
    expect(clampIndex(I2_TEST, 1e9)).toBe(99999);
  });
  it("legs and series follow the scenario", () => {
    const s = scenarioAt(I2_TEST, 90001);
    const legs = legsOf(s);
    expect(legs.leg1[0]).toBe(0);
    expect(legs.turn[1]).toBe(s.metadata.zig_index);
    expect(legs.leg2[1]).toBe(s.metadata.samples);
    const ser = seriesOf(s);
    expect(ser.t).toHaveLength(s.metadata.samples);
    expect(ser.bearingObsDeg.filter((b) => b === null).length).toBe(
      s.observations.filter((o) => !o.valid).length,
    );
    // Iteration 1 has an instantaneous zig: no turn samples.
    const i1 = scenarioAt(I1_TEST, 90001);
    expect(legsOf(i1).turn[0]).toBe(legsOf(i1).turn[1]);
    expect(sampleAt(s, 1e9)).toBe(s.metadata.samples - 1);
  });
});

describe("estimates and errors", () => {
  it("classical and naive rows start after the zig, and errors use the SRD §5 definitions", () => {
    const s = scenarioAt(I2_TEST, 90002);
    const cl = classicalRows(s);
    const nv = naiveRows(s, MEANS);
    expect(cl.rows).toHaveLength(s.metadata.samples - s.metadata.zig_index - 1);
    expect(nv.rows[0]?.speed_mps).toBeCloseTo(5.9, 5);
    expect(rowAtSample(cl, s, s.metadata.zig_index)).toBeNull();
    expect(rowAtSample(cl, s, s.metadata.zig_index + 1)).not.toBeNull();
    const e = scenarioErrors(s, nv);
    expect(e.rows).toBe(nv.rows.length);
    expect(e.speedKtMedian).toBeGreaterThanOrEqual(0);
    const nd = viewNdjson(s, [cl, nv]).trimEnd().split("\n");
    expect(nd).toHaveLength(3);
    expect(nd[0]).toBe(canonicalJson(s));
  });
});

describe("view state", () => {
  const cat: ViewerCatalogue = {
    generatorVersion: "0.2.0",
    sources: [I2_TEST, I1_TEST],
    pairs: [
      {
        id: "i1",
        label: "",
        experiment: "",
        gate: "",
        instantaneous: {} as never,
        timeLate: {} as never,
        naive: MEANS,
      },
      {
        id: "2c",
        label: "",
        experiment: "",
        gate: "",
        instantaneous: {} as never,
        timeLate: {} as never,
        naive: MEANS,
      },
    ],
    bookmarks: [],
  };
  it("round-trips and falls back to defaults", () => {
    const v = {
      source: "i1-test",
      index: 90123,
      mode: "time-late" as const,
      t: 720,
      pair: "i1",
      classical: false,
      trueBearings: true,
    };
    expect(decodeView(encodeView(v), cat)).toEqual(v);
    expect(decodeView("src=nope&i=-4&mode=bad&t=x", cat)).toEqual({
      source: "i2-test",
      index: 90000,
      mode: "truth",
      t: null,
      pair: "2c",
      classical: true,
      trueBearings: false,
    });
  });
});

describe("three legs (generator 0.3.0)", () => {
  it("legs cover the window contiguously, with the second turn and leg 3", () => {
    const src = { ...I2_TEST, id: "i3", ranges: ranges("iter3-ranges.json") };
    for (const i of [90000, 90001, 90002]) {
      const s = scenarioAt(src, i);
      const l = legsOf(s);
      if (l.turn2 === undefined || l.leg3 === undefined) throw new Error("no second zig");
      expect(l.leg1[1]).toBe(l.turn[0]);
      expect(l.turn[1]).toBe(l.leg2[0]);
      expect(l.leg2[1]).toBe(l.turn2[0]);
      expect(l.turn2[1]).toBe(l.leg3[0]);
      expect(l.leg3[1]).toBe(s.metadata.samples);
      expect(l.turn2[1]).toBeGreaterThan(l.turn2[0]);
    }
  });
});
