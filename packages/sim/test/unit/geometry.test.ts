import { describe, expect, it } from "vitest";
import {
  angleDiff,
  bearingOf,
  degToRad,
  ktToMps,
  mpsToKt,
  radToDeg,
  wrap2pi,
} from "../../src/geometry.js";

const close = (a: number, b: number): void => {
  expect(a).toBeCloseTo(b, 12);
};

describe("bearingOf", () => {
  it("is clockwise from north", () => {
    close(bearingOf(0, 1), 0);
    close(bearingOf(1, 0), Math.PI / 2);
    close(bearingOf(0, -1), Math.PI);
    close(bearingOf(-1, 0), (3 * Math.PI) / 2);
  });
});

describe("wrap2pi", () => {
  it("maps into [0, 2π)", () => {
    close(wrap2pi(-0.1), 2 * Math.PI - 0.1);
    close(wrap2pi(2 * Math.PI), 0);
    close(wrap2pi(5 * Math.PI), Math.PI);
    expect(wrap2pi(-1e-18)).toBeLessThan(2 * Math.PI);
  });
});

describe("angleDiff", () => {
  it("wraps across north: 1° − 359° = +2°", () => {
    close(radToDeg(angleDiff(degToRad(1), degToRad(359))), 2);
    close(radToDeg(angleDiff(degToRad(359), degToRad(1))), -2);
  });
});

describe("units", () => {
  it("converts knots exactly (1 kt = 1852/3600 m/s)", () => {
    close(ktToMps(10), 18520 / 3600);
    close(mpsToKt(ktToMps(7.3)), 7.3);
  });
});
