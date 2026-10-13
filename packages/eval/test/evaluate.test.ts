// T022: SRD §5 window-mean position error (spec 003 R10).
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { rowError } from "../src/errors.js";
import { evaluate, windowMeanPosition } from "../src/evaluate.js";
import { scenarios, set, truthRow } from "./helpers.js";

/** Per-timestep prediction: row k sits k+1 samples after the zig, shifted east by offsets[k] m. */
function shifted(s: Scenario, offsets: (number | null)[]): Prediction {
  const rows: PredictionRow[] = offsets.map((d, k) => {
    const r = truthRow(s, s.metadata.zig_index + 1 + k);
    return d === null ? { ...r, converged: false } : { ...r, x_m: r.x_m + d };
  });
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: "model",
    mode: "per_timestep",
    rows,
  };
}

const overallFinal = (preds: Prediction[], ss: Scenario[]) => {
  const m = evaluate(ss, [set("model:per_timestep", preds)]).metrics.find(
    (r) => r.slice === "overall" && r.point === "final",
  );
  if (m === undefined) throw new Error("no overall final record");
  return m;
};

describe("window-mean position error (T022)", () => {
  const ss = scenarios(11n, 4);
  const [a, b, c, d] = ss;
  if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error();

  it("per scenario: mean over converged rows; non-converged rows excluded and counted", () => {
    const errs = (p: Prediction, s: Scenario) => p.rows.map((r) => rowError(s, r));
    const wa = windowMeanPosition(errs(shifted(a, [10, 20, 30]), a));
    expect(wa.mean).toBeCloseTo(20, 6);
    expect(wa.excludedRows).toBe(0);
    const wb = windowMeanPosition(errs(shifted(b, [100, null, 200]), b));
    expect(wb.mean).toBeCloseTo(150, 6);
    expect(wb.excludedRows).toBe(1);
    const wd = windowMeanPosition(errs(shifted(d, [null, null]), d));
    expect(wd.mean).toBe(Infinity);
    expect(wd.excludedRows).toBe(2);
  });

  it("median and P90 over scenarios (nearest rank), on the final records only", () => {
    const three = [shifted(a, [10, 20, 30]), shifted(b, [100, null, 200]), shifted(c, [40])];
    const m = overallFinal(three, [a, b, c]);
    // Sorted per-scenario means [20, 40, 150]: median rank 2, P90 rank 3.
    expect(m.position_window_m_median).toBeCloseTo(40, 6);
    expect(m.position_window_m_p90).toBeCloseTo(150, 6);
    const z = evaluate([a, b, c], [set("model:per_timestep", three)], {
      points: [60],
      curveStep: 60,
    }).metrics.filter((r) => r.point !== "final");
    expect(z.length).toBeGreaterThan(0);
    for (const r of z) expect(r.position_window_m_median).toBeUndefined();
  });

  it("a scenario with no estimate ranks worst: an infinite P90 is left absent", () => {
    const four = [
      shifted(a, [10, 20, 30]),
      shifted(b, [100, null, 200]),
      shifted(c, [40]),
      shifted(d, [null, null]),
    ];
    const m = overallFinal(four, ss);
    // [20, 40, 150, ∞]: median rank 2 = 40; P90 rank 4 = ∞ (JSON cannot hold it).
    expect(m.position_window_m_median).toBeCloseTo(40, 6);
    expect(m.position_window_m_p90).toBeUndefined();
  });
});
