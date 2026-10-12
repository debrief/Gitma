import type { CurvePoint, MetricsRecord } from "@tma/types";
import { describe, expect, it } from "vitest";
import { CURVE_COLUMNS, parseCurvesCsv, toCsv } from "../src/csv.js";
import { type G1Ids, g1Checks, g1Verdict } from "../src/gate-g1.js";

const IDS: G1Ids = {
  instantaneous: "lstm",
  timeLate: "bilstm",
  causalControl: "cnn",
  mlpControl: "mlp",
  shuffled: "lstm-shuffled",
};

type Medians = Record<string, { z300: number; final: number }>;

const BASE: Medians = {
  naive: { z300: 0.4, final: 0.4 },
  classical: { z300: 0.1, final: 0.05 },
  lstm: { z300: 0.15, final: 0.1 },
  bilstm: { z300: 0.12, final: 0.08 },
  cnn: { z300: 0.3, final: 0.25 },
  mlp: { z300: 0.2, final: 0.15 },
  "lstm-shuffled": { z300: 0.41, final: 0.4 },
};

function metrics(m: Medians): MetricsRecord[] {
  return Object.entries(m).flatMap(([id, v]) =>
    (
      [
        ["zig+300s", v.z300],
        ["final", v.final],
      ] as const
    ).map(([point, median]) => ({
      estimator: `${id}:per_timestep`,
      slice: "overall",
      point,
      n: 100,
      excluded: 0,
      range_rel_median: median,
    })),
  );
}

function curves(lstm: number[], bilstm: number[]): CurvePoint[] {
  const pts = (id: string, vs: number[]): CurvePoint[] =>
    vs.map((v, i) => ({
      estimator: `${id}:per_timestep`,
      t_since_zig_s: 60 * (i + 1),
      n: 1000,
      range_rel_median: v,
      range_rel_p90: 2 * v,
      course_deg_median: 10,
      speed_kt_median: 1,
      gross_error_rate: 0,
    }));
  return [...pts("lstm", lstm), ...pts("bilstm", bilstm)];
}

const GOOD_CURVES = curves([0.3, 0.2, 0.15], [0.25, 0.18, 0.12]);
const result = (m: Medians, c = GOOD_CURVES, ids = IDS) =>
  Object.fromEntries(g1Checks(metrics(m), c, ids).map((x) => [x.name, x.result]));

describe("G1 gate", () => {
  it("passes when both variants beat half of naive and every check holds", () => {
    const checks = g1Checks(metrics(BASE), GOOD_CURVES, IDS);
    expect(checks.map((c) => c.name)).toEqual([
      "g1-instantaneous",
      "g1-time-late",
      "time-late-not-worse",
      "instantaneous-beats-control",
      "time-late-beats-control",
      "shuffled-labels-at-naive",
    ]);
    expect(g1Verdict(checks)).toMatchObject({ gate: "G1", result: "pass" });
  });

  it("fails when either variant is not below 0.5 × naive", () => {
    expect(result({ ...BASE, lstm: { z300: 0.2, final: 0.1 } })["g1-instantaneous"]).toBe("fail");
    expect(result({ ...BASE, bilstm: { z300: 0.21, final: 0.1 } })["g1-time-late"]).toBe("fail");
    const v = g1Verdict(
      g1Checks(metrics({ ...BASE, lstm: { z300: 0.2, final: 0.1 } }), GOOD_CURVES, IDS),
    );
    expect(v.result).toBe("fail");
  });

  it("flags a curve point where time-late > 1.05 × instantaneous", () => {
    expect(result(BASE, curves([0.3, 0.2, 0.15], [0.25, 0.211, 0.12]))["time-late-not-worse"]).toBe(
      "fail",
    );
    expect(result(BASE, curves([0.3, 0.2, 0.15], [0.25, 0.209, 0.12]))["time-late-not-worse"]).toBe(
      "pass",
    );
  });

  it("flags a recurrent model that does not beat its control at zig+300s or final", () => {
    expect(result({ ...BASE, cnn: { z300: 0.3, final: 0.1 } })["instantaneous-beats-control"]).toBe(
      "fail",
    );
    expect(result({ ...BASE, mlp: { z300: 0.12, final: 0.15 } })["time-late-beats-control"]).toBe(
      "fail",
    );
  });

  it("leakage check passes within ±10% of naive and fails outside", () => {
    const at = (z300: number) => result({ ...BASE, "lstm-shuffled": { z300, final: 0.4 } });
    expect(at(0.37)["shuffled-labels-at-naive"]).toBe("pass");
    expect(at(0.43)["shuffled-labels-at-naive"]).toBe("pass");
    expect(at(0.35)["shuffled-labels-at-naive"]).toBe("fail");
    expect(at(0.45)["shuffled-labels-at-naive"]).toBe("fail");
  });

  it("fails G1 when the model was scored on different scenarios from naive", () => {
    const ms = metrics(BASE).map((m) =>
      m.estimator === "lstm:per_timestep" && m.point === "zig+300s"
        ? { ...m, n: 90, excluded: 10 }
        : m,
    );
    const c = g1Checks(ms, GOOD_CURVES, IDS).find((x) => x.name === "g1-instantaneous");
    expect(c?.result).toBe("fail");
    expect(c?.detail).toMatch(/sample mismatch/);
  });

  it("treats a missing (non-finite) median as worse than any limit", () => {
    const ms = metrics(BASE).map((m) => {
      if (m.estimator !== "bilstm:per_timestep") return m;
      const rest = { ...m };
      delete rest.range_rel_median;
      return rest;
    });
    expect(
      Object.fromEntries(g1Checks(ms, GOOD_CURVES, IDS).map((x) => [x.name, x.result]))[
        "g1-time-late"
      ],
    ).toBe("fail");
  });

  it("fails (never passes) when naive's median at the gate point is absent or non-finite", () => {
    const noNaive = (replace: (m: MetricsRecord) => MetricsRecord) =>
      metrics(BASE).map((m) =>
        m.estimator === "naive:per_timestep" && m.point === "zig+300s" ? replace(m) : m,
      );
    const absent = noNaive((m) => {
      const rest = { ...m };
      delete rest.range_rel_median;
      return rest;
    });
    const infinite = noNaive((m) => ({ ...m, range_rel_median: Infinity }));
    const ci = { ratio: 0.3, lo: 0.2, hi: 0.4, n: 100, resamples: 2000, seed: "1" };
    for (const ms of [absent, infinite]) {
      const checks = g1Checks(ms, GOOD_CURVES, IDS);
      for (const name of ["g1-instantaneous", "g1-time-late"]) {
        const c = checks.find((x) => x.name === name);
        expect(c?.result).toBe("fail");
        expect(c?.detail).toMatch(/naive median not finite/);
      }
      const withCi = g1Checks(ms, GOOD_CURVES, IDS, { instantaneous: ci, timeLate: ci });
      expect(withCi.find((x) => x.name === "g1-instantaneous")?.result).toBe("fail");
      expect(g1Verdict(withCi).result).toBe("fail");
    }
  });

  it("shuffled-label check reports course error beside naive without gating on it", () => {
    const withCourse = (shuffledCourse: number) =>
      metrics(BASE).map((m) =>
        m.point !== "zig+300s"
          ? m
          : m.estimator === "naive:per_timestep"
            ? { ...m, course_deg_median: 89.7 }
            : m.estimator === "lstm-shuffled:per_timestep"
              ? { ...m, course_deg_median: shuffledCourse }
              : m,
      );
    const leak = (ms: MetricsRecord[]) =>
      g1Checks(ms, GOOD_CURVES, IDS).find((x) => x.name === "shuffled-labels-at-naive");
    const near = leak(withCourse(82.9));
    expect(near?.result).toBe("pass");
    expect(near?.detail).toMatch(
      /course error median 82\.9° vs naive 89\.7° \(reported, not gated\)/,
    );
    // A far better course than naive does not fail the check: the rule is range only.
    expect(leak(withCourse(5))?.result).toBe("pass");
    expect(leak(metrics(BASE))?.detail).toMatch(/course error median n\/a vs naive n\/a/);
  });

  it("does not gate curve points with fewer than 500 scenarios", () => {
    const c = curves([0.3, 0.2, 0.15], [0.25, 0.18, 0.5]).map((p) =>
      p.t_since_zig_s === 180 ? { ...p, n: 35 } : p,
    );
    const check = g1Checks(metrics(BASE), c, IDS).find((x) => x.name === "time-late-not-worse");
    expect(check?.result).toBe("pass");
    expect(check?.detail).toMatch(/1 later points with n < 500/);
  });

  it("refuses without both baselines (FR-019)", () => {
    const noClassical: Medians = { ...BASE };
    delete noClassical.classical;
    expect(() => g1Checks(metrics(noClassical), GOOD_CURVES, IDS)).toThrow(/classical/);
  });

  it("reads back curves.csv as written", () => {
    expect(parseCurvesCsv(toCsv(CURVE_COLUMNS, GOOD_CURVES))).toEqual(GOOD_CURVES);
  });

  it("tiered verdict: ratio decides; leakage voids; consistency suspends; controls report only", () => {
    const verdict = (m: Medians, c = GOOD_CURVES) => g1Verdict(g1Checks(metrics(m), c, IDS)).result;
    expect(verdict({ ...BASE, cnn: { z300: 0.3, final: 0.1 } })).toBe("pass");
    expect(verdict({ ...BASE, mlp: { z300: 0.12, final: 0.15 } })).toBe("pass");
    expect(verdict({ ...BASE, "lstm-shuffled": { z300: 0.3, final: 0.4 } })).toBe("fail");
    expect(verdict(BASE, curves([0.3, 0.2, 0.15], [0.25, 0.211, 0.12]))).toBe("inconclusive");
    expect(
      verdict(
        { ...BASE, lstm: { z300: 0.2, final: 0.1 } },
        curves([0.3, 0.2, 0.15], [0.25, 0.211, 0.12]),
      ),
    ).toBe("fail");
  });

  it("with bootstrap intervals: pass below, fail above, inconclusive across the 0.5 ratio", () => {
    const ci = (lo: number, hi: number) => ({
      ratio: (lo + hi) / 2,
      lo,
      hi,
      n: 1000,
      resamples: 2000,
      seed: "1",
    });
    const run = (lo: number, hi: number) =>
      g1Verdict(
        g1Checks(metrics(BASE), GOOD_CURVES, IDS, {
          instantaneous: ci(lo, hi),
          timeLate: ci(0.2, 0.3),
        }),
      );
    expect(run(0.3, 0.45).result).toBe("pass");
    expect(run(0.55, 0.7).result).toBe("fail");
    const v = run(0.45, 0.55);
    expect(v.result).toBe("inconclusive");
    expect(v.checks.find((c) => c.name === "g1-instantaneous")?.detail).toMatch(
      /95% CI \[0\.450, 0\.550\]/,
    );
  });
});
