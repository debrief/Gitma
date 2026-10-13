// T024: model-versus-classical comparison on common rows (spec 003 R9).
import { describe, expect, it } from "vitest";
import { compareOnCommonRows } from "../src/compare.js";
import { finalPred, scenarios, set, truthRow } from "./helpers.js";

describe("common-row comparison (T024)", () => {
  const ss = scenarios(21n, 4);
  const last = (i: number) => {
    const s = ss[i];
    if (s === undefined) throw new Error();
    return { s, row: truthRow(s, s.metadata.samples - 1) };
  };
  const model = [0, 1, 2, 3].map((i) => {
    const { s, row } = last(i);
    if (i === 1) return finalPred(s, "model", { ...row, converged: false });
    if (i === 3) return finalPred(s, "model", { ...row, range_m: row.range_m * 1.1 });
    return finalPred(s, "model", row);
  });
  const classical = [0, 1, 2, 3].map((i) => {
    const { s, row } = last(i);
    // Converged but non-finite: not an answer either.
    return finalPred(s, "classical", i === 2 ? { ...row, range_m: NaN } : row);
  });
  const out = compareOnCommonRows(
    ss,
    [set("model", model), set("classical", classical)],
    "classical",
    [],
  );
  const overall = out.find((r) => r.slice === "overall" && r.point === "final");

  it("excludes rows where either estimator is non-converged or non-finite", () => {
    expect(overall?.n_common).toBe(2);
    expect(overall?.range_rel_median).toBeLessThan(1e-9);
    expect(overall?.range_rel_p90).toBeCloseTo(0.1, 6);
    expect(overall?.range_rel_p90_ref).toBeLessThan(1e-9);
    expect(overall?.gross_error_rate).toBe(0);
    expect(overall?.gross_error_rate_ref).toBe(0);
  });

  it("reports each estimator's coverage separately", () => {
    expect(overall?.estimator).toBe("model");
    expect(overall?.reference).toBe("classical");
    expect(overall?.coverage_estimator).toBe(3 / 4);
    expect(overall?.coverage_reference).toBe(3 / 4);
  });

  it("compares per slice and never the reference with itself", () => {
    expect(out.every((r) => r.estimator === "model")).toBe(true);
    expect(out.some((r) => r.slice.startsWith("dropout_band="))).toBe(true);
    const sum = out.filter((r) => r.slice.startsWith("sigma=")).reduce((a, r) => a + r.n_common, 0);
    expect(sum).toBe(2);
  });

  it("skips points an estimator has no row for, and refuses an unknown reference", () => {
    const z = compareOnCommonRows(
      ss,
      [set("model", model), set("classical", classical)],
      "classical",
      [300],
    );
    expect(z.some((r) => r.point === "zig+300s")).toBe(false);
    expect(() => compareOnCommonRows(ss, [set("model", model)], "classical", [])).toThrow(
      /no such estimator/,
    );
  });
});
