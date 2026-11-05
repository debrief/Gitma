// Spec 017: G6's scoring rules on generated phase-4 scenarios with synthetic detector scores:
// events, delays (with the armed rule), false alarms on quiet rows, calibration, and the checks.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  calibrateThreshold,
  eventDelay,
  falseAlarmRate,
  falseAlarms,
  g6Checks,
  g6Events,
  g6Verdict,
  type Scores,
} from "../src/gate-g6.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
// σ = 1° only, as G6's rows.
const ONE_DEG: ParameterRanges = { ...PHASE4, noise_sigma_rad_values: [Math.PI / 180] };
const scen: Scenario[] = Array.from(
  { length: 120 },
  (_, i) => generateScenario(23n, i, ONE_DEG).scenario,
);

/** Scores from a rule `f(s, k)` on every row from zig_index + 1. */
function scores(f: (s: Scenario, k: number) => number): Scores {
  const m: Scores = new Map();
  for (const s of scen) {
    const dt = s.metadata.parameters.dt_s;
    const ks = Array.from(
      { length: s.metadata.samples - s.metadata.zig_index - 1 },
      (_, j) => s.metadata.zig_index + 1 + j,
    );
    m.set(s.metadata.index, {
      t: Float64Array.from(ks, (k) => k * dt),
      score: Float32Array.from(ks, (k) => f(s, k)),
    });
  }
  return m;
}
const courseStarts = (s: Scenario): number[] =>
  (s.metadata.manoeuvres ?? []).filter((x) => x.kind === "course").map((x) => x.start_index);
/** 1 for `lag` .. `lag + 3` samples after each course change starts, else 0. */
const after = (lag: number) =>
  scores((s, k) => (courseStarts(s).some((st) => k >= st + lag && k < st + lag + 3) ? 1 : 0));

describe("G6 scoring (spec 017)", () => {
  const { events, scenarios } = g6Events(scen);

  it("takes the course changes that start on a row, windowed to 10 min and the next start", () => {
    expect(events.length).toBeGreaterThan(50);
    for (const e of events) {
      expect(e.start).toBeGreaterThan(e.s.metadata.zig_index);
      expect(e.end - e.start).toBeLessThanOrEqual(600 / e.s.metadata.parameters.dt_s);
      const next = (e.s.metadata.manoeuvres ?? [])
        .map((x) => x.start_index)
        .filter((x) => x > e.start);
      if (next.length) expect(e.end).toBeLessThanOrEqual(Math.min(...next));
    }
    // A σ = 2° scenario contributes nothing.
    const two = generateScenario(23n, 0, { ...PHASE4, noise_sigma_rad_values: [Math.PI / 90] });
    expect(g6Events([two.scenario]).scenarios).toHaveLength(0);
  });

  it("delay is the first row at or above the threshold; a miss or a standing alarm is +∞", () => {
    const e = events[0];
    if (e === undefined) throw new Error("no events");
    const n = e.s.metadata.samples;
    const at = (ks: number[]): Float64Array => {
      const b = new Float64Array(n);
      for (const k of ks) b[k] = 1;
      return b;
    };
    const dt = e.s.metadata.parameters.dt_s;
    expect(eventDelay(e, at([e.start + 4]), 0.5)).toBe(4 * dt);
    expect(eventDelay(e, at([e.start]), 0.5)).toBe(0);
    expect(eventDelay(e, at([]), 0.5)).toBe(Infinity);
    expect(eventDelay(e, at([e.end]), 0.5)).toBe(Infinity); // after the window
    expect(eventDelay(e, at([e.start - 1, e.start + 2]), 0.5)).toBe(Infinity); // masked
  });

  it("false alarms are onsets on quiet rows only, per hour", () => {
    const s = scenarios[0]?.s;
    if (s === undefined) throw new Error("no scenarios");
    const n = s.metadata.samples;
    const b = new Float64Array(n);
    // A held alarm is one onset; two separated ones are two.
    const quiet: number[] = [];
    for (let k = s.metadata.zig_index + 1; k < n; k++) {
      const spans = s.metadata.manoeuvres ?? [];
      const inside = spans.some((x) => x.start_index - 30 <= k && k < x.end_index + 31);
      if (!inside) quiet.push(k);
    }
    const [q1, q2] = [quiet[0], quiet[10]];
    if (q1 === undefined || q2 === undefined) return;
    b[q1] = 1;
    b[q1 + 1] = 1;
    b[q2] = 1;
    const f = falseAlarms(s, b, 0.5);
    expect(f.onsets).toBe(2);
    expect(f.hours).toBeGreaterThan(0);
    // An oracle that fires only during manoeuvres raises no false alarm.
    expect(falseAlarmRate(scenarios, after(0), 0.5)).toBe(0);
  });

  it("calibration finds the threshold at the target rate", () => {
    // Scores rising with k mod 50: the rate falls as the threshold rises.
    const sc = scores((_s, k) => k % 50);
    const r = calibrateThreshold(scenarios, sc, 2);
    expect(r.rate).toBeLessThanOrEqual(2);
    expect(falseAlarmRate(scenarios, sc, r.threshold * 0.99)).toBeGreaterThan(2);
  });

  it("passes a faster detector at no more false alarms, and fails a slower one", () => {
    const fast = { label: "fast", scores: after(1), threshold: 0.5 };
    const slow = { label: "slow", scores: after(12), threshold: 0.5 };
    const v = g6Verdict(g6Checks(scen, fast, slow, 400));
    expect(v.gate).toBe("G6");
    expect(v.checks.map((c) => c.result)).toEqual(["pass", "pass", "pass"]);
    expect(v.result).toBe("pass");
    const w = g6Verdict(g6Checks(scen, slow, fast, 400));
    expect(w.checks.find((c) => c.name.endsWith("g6-delay"))?.result).toBe("fail");
    expect(w.result).toBe("fail");
  });

  it("refuses a detector that buys its speed with false alarms", () => {
    // Fires at every manoeuvre start and also every 15 samples: fast, but many false alarms.
    const both = scores((s, k) =>
      courseStarts(s).some((st) => k >= st && k < st + 3) || k % 15 === 0 ? 1 : 0,
    );
    const v = g6Verdict(
      g6Checks(
        scen,
        { label: "noisy", scores: both, threshold: 0.5 },
        { label: "ref", scores: after(6), threshold: 0.5 },
        400,
      ),
    );
    expect(v.checks.find((c) => c.name.endsWith("g6-false-alarms"))?.result).toBe("fail");
    expect(v.result).toBe("fail");
  });

  it("judges no delay ratio when both detectors miss half the events (median +∞)", () => {
    const never = { label: "never", scores: scores(() => 0), threshold: 0.5 };
    const v = g6Checks(scen, never, { ...never, label: "also-never" }, 200);
    const d = v.find((c) => c.name.endsWith("g6-delay"));
    expect(d?.result).toBe("inconclusive");
    expect(d?.value).toBeUndefined();
    expect(d?.detail).toMatch(/undefined/);
  });
});
