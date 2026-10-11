import { DEFAULT_RANGES } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { fitNaive, naivePredict } from "../src/naive.js";
import { scenarios } from "./helpers.js";

describe("naive baseline", () => {
  const train = scenarios(12n, 300, DEFAULT_RANGES);

  it("fits training means of log range, course vector and speed", () => {
    const m = fitNaive(train, "digest");
    let logR = 0;
    let speed = 0;
    for (const s of train) {
      const i = s.metadata.samples - 1;
      const o = s.ownship.states[i];
      const t = s.target.states[i];
      if (o === undefined || t === undefined) throw new Error();
      logR += Math.log(Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m) / 1000);
      speed += t.speed_mps;
    }
    expect(m.final.log_range_km).toBeCloseTo(logR / 300, 10);
    expect(m.final.speed_mps).toBeCloseTo(speed / 300, 10);
    expect(m.final.n).toBe(300);
    expect(m.per_timestep.n).toBeGreaterThan(300);
    // Uniform course draws: the mean course vector is short.
    expect(Math.hypot(m.final.course_sin, m.final.course_cos)).toBeLessThan(0.2);
  });

  it("is deterministic and predicts the same values for every scenario", () => {
    expect(fitNaive(train, "d")).toEqual(fitNaive(train, "d"));
    const m = fitNaive(train, "d");
    const [a, b] = scenarios(13n, 2, DEFAULT_RANGES).map(
      (s) => naivePredict(s, m, "final").rows[0],
    );
    expect(a?.range_m).toBe(b?.range_m);
    expect(a?.course_rad).toBe(b?.course_rad);
  });

  it("per-timestep mode emits one row per post-zig sample", () => {
    const [s] = scenarios(14n, 1, DEFAULT_RANGES);
    if (s === undefined) throw new Error();
    const p = naivePredict(s, fitNaive(train, "d"), "per_timestep");
    expect(p.rows).toHaveLength(s.metadata.samples - s.metadata.zig_index - 1);
  });
});
