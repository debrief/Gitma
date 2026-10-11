import type { Prediction } from "@tma/types";
import { DEFAULT_RANGES } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { scenarios, set, truthRow } from "./helpers.js";

const perTimestep = (s: (typeof ss)[number], estimator: string): Prediction => ({
  record: "prediction",
  scenario_index: s.metadata.index,
  estimator,
  mode: "per_timestep",
  rows: Array.from({ length: s.metadata.samples - s.metadata.zig_index - 1 }, (_, k) =>
    truthRow(s, s.metadata.zig_index + 1 + k),
  ),
});

// Short windows only, so some scenarios end before zig + 300 s.
const short = { ...DEFAULT_RANGES, window_s: { min: 600, max: 700 } };
const ss = scenarios(5n, 60, short);

describe("zig+300s point and curves", () => {
  it("excludes and counts scenarios whose window ends before the gate point", () => {
    const expectedExcluded = ss.filter((s) => {
      const end = (s.metadata.samples - 1) * s.metadata.parameters.dt_s;
      return end < s.metadata.zig_time_s + 300;
    }).length;
    expect(expectedExcluded).toBeGreaterThan(0);
    const ev = evaluate(ss, [
      set(
        "classical:per_timestep",
        ss.map((s) => perTimestep(s, "classical")),
      ),
    ]);
    const r = ev.metrics.find((m) => m.slice === "overall" && m.point === "zig+300s");
    expect(r?.excluded).toBe(expectedExcluded);
    expect((r?.n ?? 0) + (r?.excluded ?? 0)).toBe(60);
  });

  it("curves are sampled every curve step after the zig", () => {
    const ev = evaluate(ss, [
      set(
        "classical:per_timestep",
        ss.map((s) => perTimestep(s, "classical")),
      ),
    ]);
    expect(ev.curves.map((c) => c.t_since_zig_s).slice(0, 3)).toEqual([60, 120, 180]);
    expect(ev.curves.every((c) => (c.range_rel_median ?? Infinity) < 1e-6)).toBe(true);
  });
});
