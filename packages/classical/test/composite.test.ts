// Spec 025: the composite solver (composite.ts) and its name.
import type { Prediction, PredictionRow } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  compositeName,
  compositePredict,
  FIT_SIGMA_FLOOR_RAD,
  fitStatistic,
} from "../src/composite.js";
import { bearingData, classicalPredict } from "../src/estimate.js";
import { parseCompositeName } from "../src/names.js";
import { NOISE_FREE, scenarios } from "./helpers.js";

const [s] = scenarios(11n, 1, NOISE_FREE);
if (s === undefined) throw new Error("no scenario");
const dt = s.metadata.parameters.dt_s;

/** A stand-in fused file: a row at every sample, distinguishable from least squares. */
const fusedOf = (rows: number): Prediction => ({
  record: "prediction",
  scenario_index: s.metadata.index,
  estimator: "fused-net-imm",
  mode: "per_timestep",
  rows: Array.from({ length: rows }, (_, i): PredictionRow => ({
    timestamp_s: i * dt,
    range_m: 1234,
    course_rad: 0.5,
    speed_mps: 3,
    x_m: 1,
    y_m: 2,
    converged: true,
  })),
});

describe("composite name", () => {
  it("round-trips and refuses non-canonical names", () => {
    const p = { window: 30, threshold: 4 };
    const n = compositeName("classical", "fused-net-imm", p);
    expect(n).toBe("composite-classical-fused-net-imm-w30-c4");
    expect(parseCompositeName(n, "classical", "fused-net-imm")).toEqual(p);
    expect(
      parseCompositeName(
        "composite-classical-fused-net-imm-w30-c4.0",
        "classical",
        "fused-net-imm",
      ),
    ).toBeNull();
    expect(parseCompositeName(n, "classical", "fused-other")).toBeNull();
    expect(
      parseCompositeName("composite-classical-fused-net-imm-w0-c4", "classical", "fused-net-imm"),
    ).toBeNull();
  });
});

describe("composite solver", () => {
  const c = classicalPredict(s, "per_timestep");
  const f = fusedOf(s.metadata.samples);

  it("the fit statistic is ~0 for the least-squares fit of noise-free constant-velocity bearings", () => {
    const d = bearingData(s);
    const last = c.rows[c.rows.length - 1];
    if (last === undefined) throw new Error("no rows");
    const i = Math.round(last.timestamp_s / dt);
    const stat = fitStatistic(d, last, i, 30, 0);
    expect(stat).not.toBeNull();
    // float32 rows: residuals well under the 0.1° floor
    expect(stat ?? Infinity).toBeLessThan(0.05);
    expect(FIT_SIGMA_FLOOR_RAD).toBeCloseTo((0.1 * Math.PI) / 180, 12);
  });

  it("keeps least squares throughout a constant-velocity scenario", () => {
    const out = compositePredict(s, c, f, { window: 30, threshold: 4 });
    expect(out.estimator).toBe("composite-classical-fused-net-imm-w30-c4");
    expect(out.rows).toEqual(c.rows);
  });

  it("switches to the fused tracker on a bad fit and stays switched", () => {
    const bad = { ...c, rows: c.rows.map((r) => ({ ...r })) };
    const k = 10;
    const r = bad.rows[k];
    if (r === undefined) throw new Error("too few rows");
    r.course_rad = r.course_rad + Math.PI / 2; // a velocity the bearings do not support
    const out = compositePredict(s, bad, f, { window: 30, threshold: 4 });
    const idx = (row: PredictionRow): number => Math.round(row.timestamp_s / dt);
    out.rows.forEach((o, j) => {
      const want = j < k ? bad.rows[j] : f.rows[idx(o)];
      expect(o).toEqual(want);
    });
  });

  it("uses the fused row for a non-converged least-squares row without latching", () => {
    const nc = { ...c, rows: c.rows.map((r, j) => (j === 5 ? { ...r, converged: false } : r)) };
    const out = compositePredict(s, nc, f, { window: 30, threshold: 4 });
    out.rows.forEach((o, j) => {
      const row = nc.rows[j];
      if (row === undefined) throw new Error("row");
      expect(o).toEqual(j === 5 ? f.rows[Math.round(row.timestamp_s / dt)] : row);
    });
  });

  it("refuses inputs that do not line up", () => {
    expect(() =>
      compositePredict(s, c, { ...f, scenario_index: 99 }, { window: 30, threshold: 4 }),
    ).toThrow(/scenario/);
    expect(() => compositePredict(s, c, fusedOf(3), { window: 30, threshold: 4 })).toThrow(
      /no row/,
    );
    expect(() =>
      compositePredict(s, { ...c, mode: "final" }, f, { window: 30, threshold: 4 }),
    ).toThrow(/per-timestep/);
  });
});
