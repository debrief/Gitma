// T025: G2 gate (spec 003 US4, research R7–R8).
import type { CurvePoint, MetricsRecord } from "@tma/types";
import { describe, expect, it } from "vitest";
import type { BootstrapReport, IntervalMetric, MedianIntervalRecord } from "../src/bootstrap.js";
import type { G1Ids } from "../src/gate-g1.js";
import { g2Checks, g2Verdict } from "../src/gate-g2.js";

const IDS: G1Ids = {
  instantaneous: "lstm",
  timeLate: "bilstm",
  causalControl: "cnn",
  mlpControl: "mlp",
  shuffled: "lstm-shuffled",
};

/** [median, lo, hi] per metric at its gate point (range/course at 300 s, speed at 600 s). */
type Ci = [number, number, number];
interface Model {
  range: Ci;
  course: Ci;
  speed: Ci;
}

const GOOD: Model = { range: [0.15, 0.13, 0.17], course: [6, 5, 7], speed: [0.7, 0.6, 0.8] };

/** G1-path overall medians at zig+300s and final (as in gate-g1.test.ts). */
const OVERALL: Record<string, [number, number]> = {
  naive: [0.4, 0.4],
  classical: [0.1, 0.05],
  lstm: [0.15, 0.1],
  bilstm: [0.12, 0.08],
  cnn: [0.3, 0.25],
  mlp: [0.2, 0.15],
  "lstm-shuffled": [0.41, 0.4],
};

const label = (id: string) => `${id}:per_timestep`;

function build(
  models: Record<string, Model>,
  n: Record<string, number> = {},
): { metrics: MetricsRecord[]; boot: BootstrapReport } {
  const metrics: MetricsRecord[] = [];
  const medians: MedianIntervalRecord[] = [];
  const all: Record<string, Model> = {
    naive: { range: [0.36, 0.35, 0.37], course: [89, 85, 92], speed: [4.2, 4, 4.4] },
    classical: { range: [0.09, 0.08, 0.1], course: [3.7, 3.5, 4], speed: [0.61, 0.56, 0.67] },
    ...models,
  };
  for (const [id, m] of Object.entries(all)) {
    const count = n[id] ?? 1000;
    metrics.push(
      {
        estimator: label(id),
        slice: "sigma=1deg",
        point: "zig+300s",
        n: count,
        excluded: 0,
        range_rel_median: m.range[0],
        course_deg_median: m.course[0],
        speed_kt_median: 9,
      },
      {
        estimator: label(id),
        slice: "sigma=1deg",
        point: "zig+600s",
        n: count,
        excluded: 0,
        range_rel_median: 0.01,
        course_deg_median: 1,
        speed_kt_median: m.speed[0],
      },
    );
    const ci = (metric: IntervalMetric, point: string, c: Ci): MedianIntervalRecord => ({
      estimator: label(id),
      slice: "sigma=1deg",
      point,
      metric,
      n: count,
      median: c[0],
      lo: c[1],
      hi: c[2],
    });
    medians.push(
      ci("range_rel", "zig+300s", m.range),
      ci("course_deg", "zig+300s", m.course),
      ci("speed_kt", "zig+600s", m.speed),
    );
  }
  for (const [id, [z300, fin]] of Object.entries(OVERALL)) {
    for (const [point, v] of [
      ["zig+300s", z300],
      ["final", fin],
    ] as const) {
      metrics.push({
        estimator: label(id),
        slice: "overall",
        point,
        n: 2000,
        excluded: 0,
        range_rel_median: v,
      });
    }
  }
  const ratio = (id: string, r: number) => ({
    estimator: label(id),
    reference: label("naive"),
    slice: "overall",
    point: "zig+300s",
    metric: "range_rel" as const,
    n: 2000,
    ratio: r,
    lo: r - 0.02,
    hi: r + 0.02,
  });
  return {
    metrics,
    boot: {
      level: 0.95,
      resamples: 2000,
      seed: "20261011",
      method: "test",
      medians,
      ratios: [ratio("lstm", 0.375), ratio("bilstm", 0.3)],
    },
  };
}

const curves = (lstm: number[], bilstm: number[]): CurvePoint[] =>
  [
    ["lstm", lstm],
    ["bilstm", bilstm],
  ].flatMap(([id, vs]) =>
    (vs as number[]).map((v, i) => ({
      estimator: label(id as string),
      t_since_zig_s: 60 * (i + 1),
      n: 1000,
      range_rel_median: v,
      gross_error_rate: 0,
    })),
  );
const GOOD_CURVES = curves([0.3, 0.2, 0.15], [0.25, 0.18, 0.12]);

const judge = (models: Record<string, Model>, n?: Record<string, number>, c = GOOD_CURVES) => {
  const { metrics, boot } = build(models, n);
  return g2Verdict(g2Checks(metrics, c, boot, IDS));
};
const resultOf = (v: ReturnType<typeof judge>, name: string) =>
  v.checks.find((c) => c.name === name)?.result;

describe("G2 gate (T025)", () => {
  it("passes when every interval is clear below its threshold; G1 checks repeated", () => {
    const v = judge({ lstm: GOOD, bilstm: GOOD });
    expect(v.gate).toBe("G2");
    expect(v.result).toBe("pass");
    expect(v.checks.map((c) => c.name)).toEqual([
      "g2-instantaneous-range",
      "g2-instantaneous-course",
      "g2-instantaneous-speed",
      "g2-time-late-range",
      "g2-time-late-course",
      "g2-time-late-speed",
      "g1-instantaneous",
      "g1-time-late",
      "time-late-not-worse",
      "instantaneous-beats-control",
      "time-late-beats-control",
      "shuffled-labels-at-naive",
    ]);
    const range = v.checks[0];
    // Decision 13: the detail states the share of the slice reaching the point.
    expect(range?.detail).toMatch(/\d+\.\d% of the slice reach zig\+300s/);
    expect(range).toMatchObject({
      value: 0.15,
      threshold: 0.2,
      ci_low: 0.13,
      ci_high: 0.17,
      ci_level: 0.95,
    });
    // Reported beside naive and classical.
    expect(range?.detail).toMatch(/naive 0\.3600.*classical 0\.0900/);
    expect(v.checks[2]?.detail).toMatch(/zig\+600s/);
    // G1 checks leave the interval slots absent, as in G1 verdicts.
    expect(v.checks[6]).not.toHaveProperty("threshold");
  });

  const cases: [keyof Model, Ci, Ci, Ci][] = [
    // [criterion, pass, inconclusive (CI straddles), fail (point at/above)]
    ["range", [0.15, 0.13, 0.17], [0.19, 0.17, 0.22], [0.25, 0.22, 0.28]],
    ["course", [8, 7, 9], [9.5, 8.8, 10.3], [10, 9.5, 10.5]],
    ["speed", [0.8, 0.7, 0.9], [0.95, 0.85, 1.05], [1.2, 1.1, 1.3]],
  ];
  for (const [criterion, pass, straddle, above] of cases) {
    it(`${criterion}: pass, inconclusive when the CI straddles, fail at or above`, () => {
      const name = `g2-instantaneous-${criterion}`;
      const p = judge({ lstm: { ...GOOD, [criterion]: pass }, bilstm: GOOD });
      expect(resultOf(p, name)).toBe("pass");
      const i = judge({ lstm: { ...GOOD, [criterion]: straddle }, bilstm: GOOD });
      expect(resultOf(i, name)).toBe("inconclusive");
      expect(i.result).toBe("inconclusive");
      const f = judge({ lstm: GOOD, bilstm: { ...GOOD, [criterion]: above } });
      expect(resultOf(f, `g2-time-late-${criterion}`)).toBe("fail");
      expect(f.result).toBe("fail");
    });
  }

  it("fails on a sample mismatch with naive (or classical)", () => {
    const v = judge({ lstm: GOOD, bilstm: GOOD }, { lstm: 999 });
    expect(resultOf(v, "g2-instantaneous-range")).toBe("fail");
    expect(v.checks[0]?.detail).toMatch(/sample mismatch/);
    expect(v.result).toBe("fail");
    expect(judge({ lstm: GOOD, bilstm: GOOD }, { classical: 10 }).result).toBe("fail");
  });

  it("an absent (infinite) upper bound cannot pass", () => {
    const { metrics, boot } = build({ lstm: GOOD, bilstm: GOOD });
    const m = boot.medians.find((x) => x.estimator === "lstm:per_timestep");
    if (m === undefined) throw new Error();
    delete m.hi;
    const v = g2Verdict(g2Checks(metrics, GOOD_CURVES, boot, IDS));
    expect(resultOf(v, "g2-instantaneous-range")).toBe("inconclusive");
    expect(v.checks[0]).not.toHaveProperty("ci_high");
  });

  it("aggregates: shuffled-label failure fails; consistency failure is at best inconclusive", () => {
    const leak = build({ lstm: GOOD, bilstm: GOOD });
    for (const r of leak.metrics) {
      if (r.estimator === "lstm-shuffled:per_timestep") r.range_rel_median = 0.2;
    }
    expect(g2Verdict(g2Checks(leak.metrics, GOOD_CURVES, leak.boot, IDS)).result).toBe("fail");
    const worse = judge({ lstm: GOOD, bilstm: GOOD }, {}, curves([0.2, 0.2, 0.2], [0.3, 0.3, 0.3]));
    expect(resultOf(worse, "time-late-not-worse")).toBe("fail");
    expect(worse.result).toBe("inconclusive");
  });

  it("refuses without baselines or bootstrap intervals", () => {
    const { metrics, boot } = build({ lstm: GOOD, bilstm: GOOD });
    const noClassical = metrics.filter((r) => r.estimator !== "classical:per_timestep");
    expect(() => g2Checks(noClassical, GOOD_CURVES, boot, IDS)).toThrow(/classical/);
    expect(() => g2Checks(metrics, GOOD_CURVES, { ...boot, medians: [] }, IDS)).toThrow(
      /bootstrap interval/,
    );
    expect(() => g2Checks(metrics, GOOD_CURVES, { ...boot, ratios: [] }, IDS)).toThrow(
      /ratio interval/,
    );
  });
});
