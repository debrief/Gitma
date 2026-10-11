import { degToRad } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { rowError } from "../src/errors.js";
import { evaluate } from "../src/evaluate.js";
import { ascending, median, percentile } from "../src/stats.js";
import { finalPred, scenarios, set, truthRow } from "./helpers.js";

describe("statistics", () => {
  it("nearest-rank median and P90", () => {
    const xs = ascending([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]);
    expect(median(xs)).toBe(5);
    expect(percentile(xs, 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe("row errors", () => {
  const [s] = scenarios(1n, 1);
  if (s === undefined) throw new Error();
  const n = s.metadata.samples - 1;

  it("a perfect estimate has zero error and is not gross", () => {
    const e = rowError(s, truthRow(s, n));
    expect(e.range_rel).toBeLessThan(1e-12);
    expect(e.course_deg).toBe(0);
    expect(e.gross).toBe(false);
  });

  it("course error wraps across north: 359° vs 1° is 2°", () => {
    const row = { ...truthRow(s, n), course_rad: degToRad(359) };
    const target = s.target.states[n];
    if (target === undefined) throw new Error();
    const shifted = {
      ...s,
      target: {
        ...s.target,
        states: s.target.states.map((t) => ({ ...t, course_rad: degToRad(1) })),
      },
    };
    expect(rowError(shifted, row).course_deg).toBeCloseTo(2, 9);
  });

  it("speed error is in knots; > 50% range error or non-convergence is gross", () => {
    const tr = truthRow(s, n);
    expect(rowError(s, { ...tr, speed_mps: tr.speed_mps + 1852 / 3600 }).speed_kt).toBeCloseTo(
      1,
      6,
    );
    expect(rowError(s, { ...tr, range_m: tr.range_m * 1.6 }).gross).toBe(true);
    expect(rowError(s, { ...tr, range_m: tr.range_m * 1.4 }).gross).toBe(false);
    expect(rowError(s, { ...tr, converged: false }).gross).toBe(true);
    expect(rowError(s, { ...tr, range_m: NaN }).gross).toBe(true);
  });
});

describe("evaluate", () => {
  const ss = scenarios(2n, 50);
  const perfect = ss.map((s) => finalPred(s, "classical", truthRow(s, s.metadata.samples - 1)));

  it("corrupting one prediction moves the metrics", () => {
    const a = evaluate(ss, [set("classical", perfect)]);
    const bad = perfect.map((p, i) =>
      i === 0 ? { ...p, rows: p.rows.map((r) => ({ ...r, range_m: r.range_m * 10 })) } : p,
    );
    const b = evaluate(ss, [set("classical", bad)]);
    const overall = (m: typeof a.metrics) =>
      m.find((r) => r.slice === "overall" && r.point === "final");
    expect(overall(a.metrics)?.gross_error_rate).toBe(0);
    expect(overall(b.metrics)?.gross_error_rate).toBeCloseTo(1 / 50, 12);
  });

  it("refuses to score a scenario with no prediction", () => {
    expect(() => evaluate(ss, [set("classical", perfect.slice(1))])).toThrow(
      /no prediction for scenario/,
    );
  });
});
