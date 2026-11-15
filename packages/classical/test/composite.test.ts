// Spec 025: the composite solver (composite.ts) and its name.
import { readFileSync } from "node:fs";
import { generateScenario, noiseFree } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow } from "@tma/types";
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

describe("re-armed composite (§D.7)", () => {
  const ranges = noiseFree(
    JSON.parse(
      readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
    ) as ParameterRanges,
  );
  // A noise-free scenario with one target manoeuvre that ends well before the window does.
  const sc = Array.from({ length: 60 }, (_, i) => generateScenario(17n, i, ranges).scenario).find(
    (x) => {
      const m = x.metadata.manoeuvres ?? [];
      const last = m[m.length - 1];
      return m.length === 1 && last !== undefined && x.metadata.samples - last.end_index > 120;
    },
  );
  if (sc === undefined) throw new Error("no scenario with one early manoeuvre");
  const dtS = sc.metadata.parameters.dt_s;
  /** A perfect stand-in for the fused tracker: the truth at every sample. */
  const truthFused: Prediction = {
    record: "prediction",
    scenario_index: sc.metadata.index,
    estimator: "fused-net-imm",
    mode: "per_timestep",
    rows: sc.target.states.map((t, i): PredictionRow => {
      const o = sc.ownship.states[i];
      if (o === undefined) throw new Error("ownship");
      return {
        timestamp_s: i * dtS,
        range_m: Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m),
        course_rad: t.course_rad,
        speed_mps: t.speed_mps,
        x_m: t.x_m,
        y_m: t.y_m,
        converged: true,
      };
    }),
  };
  const lsq = classicalPredict(sc, "per_timestep");
  const p = { window: 6, threshold: 8, leg: 18, priorSd: 0.2 };

  it("names the leg settings and round-trips them", () => {
    const n = compositeName("classical", "fused-net-imm", p);
    expect(n).toBe("composite-classical-fused-net-imm-w6-c8-l18-p0.2");
    expect(parseCompositeName(n, "classical", "fused-net-imm")).toEqual(p);
  });

  it("matches the first design until the first switch, then hands back to an accurate new leg", () => {
    const first = compositePredict(sc, lsq, truthFused, { window: 6, threshold: 8 });
    const re = compositePredict(sc, lsq, truthFused, p);
    const sw = first.rows.findIndex((r, j) => r !== lsq.rows[j] && lsq.rows[j]?.converged);
    expect(sw).toBeGreaterThan(0);
    expect(re.rows.slice(0, sw)).toEqual(first.rows.slice(0, sw));
    const fusedTs = new Set(truthFused.rows);
    const legRows = re.rows
      .map((r, j) => ({ r, j }))
      .filter(({ r, j }) => j > sw && r !== lsq.rows[j] && !fusedTs.has(r));
    expect(legRows.length).toBeGreaterThan(0);
    for (const { r } of legRows) {
      const k = Math.round(r.timestamp_s / dtS);
      const t = truthFused.rows[k];
      if (t === undefined) throw new Error("truth row");
      expect(Math.abs(r.range_m - t.range_m) / t.range_m).toBeLessThan(0.02);
    }
  });

  it("refuses leg without priorSd", () => {
    expect(() =>
      compositePredict(sc, lsq, truthFused, { window: 6, threshold: 8, leg: 18 }),
    ).toThrow(/together/);
  });
});
