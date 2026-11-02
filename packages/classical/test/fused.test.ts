// The fused tracker (spec 014; SRD Annex C §C.11): the IMM with a network's range fused in.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { FUSION_DEFAULT, fusedName, fusedPredict } from "../src/fused.js";
import { type ImmParams, immPredict, immRangeUpdate } from "../src/imm.js";
import { truthAt } from "./helpers.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;
const REF: ImmParams = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
};

/** A stand-in network: the true range at every sample after the zig, with sd `sd`. */
function network(s: Scenario, sd: number | undefined, converged = true): Prediction {
  const rows: PredictionRow[] = [];
  for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
    const t = s.target.states[i];
    rows.push({
      timestamp_s: s.ownship.states[i]?.timestamp_s ?? 0,
      range_m: truthAt(s, i).range,
      course_rad: t?.course_rad ?? 0,
      speed_mps: t?.speed_mps ?? 0,
      x_m: t?.x_m ?? 0,
      y_m: t?.y_m ?? 0,
      converged,
      ...(sd === undefined ? {} : { log_range_sd: sd }),
    });
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: "net",
    mode: "per_timestep",
    rows,
  };
}

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
function rangeErrors(s: Scenario, rows: PredictionRow[]): number[] {
  return rows
    .filter((r) => r.converged)
    .map((r) => {
      const i = Math.round(r.timestamp_s / s.metadata.parameters.dt_s);
      const tr = truthAt(s, i).range;
      return Math.abs(r.range_m - tr) / tr;
    });
}

const scen = Array.from({ length: 12 }, (_, i) => generateScenario(7n, i, PHASE4).scenario);

describe("fused tracker", () => {
  it("names the network, the IMM and the fusion settings", () => {
    expect(fusedName("lstm-gaussian", REF, FUSION_DEFAULT)).toBe(
      "fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-k4-m6",
    );
  });

  it("an accurate range measurement pulls the IMM's range towards the truth", () => {
    const fused: number[] = [];
    const imm: number[] = [];
    for (const s of scen) {
      fused.push(
        ...rangeErrors(s, fusedPredict(s, REF, network(s, 0.01), { k: 1, every: 1 }).rows),
      );
      imm.push(...rangeErrors(s, immPredict(s, REF).rows));
    }
    expect(median(fused)).toBeLessThan(0.2 * median(imm));
  });

  it("adds nothing from rows that are not converged or state no sd", () => {
    for (const s of scen.slice(0, 3)) {
      const base = JSON.stringify(immPredict(s, REF).rows);
      expect(JSON.stringify(fusedPredict(s, REF, network(s, 0.01, false)).rows)).toBe(base);
      expect(JSON.stringify(fusedPredict(s, REF, network(s, undefined)).rows)).toBe(base);
    }
  });

  it("a very uncertain range leaves the IMM nearly unchanged", () => {
    const s = scen[0];
    if (s === undefined) throw new Error("no scenario");
    const a = immPredict(s, REF).rows;
    const b = fusedPredict(s, REF, network(s, 1e3), { k: 1, every: 1 }).rows;
    a.forEach((r, i) => {
      const q = b[i];
      expect(q?.converged).toBe(r.converged);
      if (r.converged)
        expect(Math.abs((q?.range_m ?? 0) - r.range_m) / r.range_m).toBeLessThan(1e-4);
    });
  });

  it("the range Jacobian matches a finite difference of ln ρ, with ownship off the origin", () => {
    // One model with a tiny covariance in x only: the update moves x by K·ν with K = P_xx H_x / S,
    // so the sign and size of H_x = dx/ρ² show in the change of x.
    const p = new Float64Array(25);
    p[0] = 1e-6;
    p[6] = 1e-12;
    p[12] = 1e-12;
    p[18] = 1e-12;
    p[24] = 1e-12;
    const st = {
      t: 0,
      models: [
        { x: Float64Array.from([3000, -4000, 0, 0, 0]), p: Float64Array.from(p) },
        { x: Float64Array.from([3000, -4000, 0, 0, 0]), p: Float64Array.from(p) },
      ] as const,
      mu: [0.5, 0.5] as [number, number],
    };
    const ox = 1000;
    const oy = 500;
    const rho = (x: number, y: number): number => Math.hypot(x - ox, y - oy);
    const z = rho(3000, -4000) * 1.001;
    const out = immRangeUpdate({ ...st, models: [st.models[0], st.models[1]] }, z, 0.01, ox, oy).st;
    const h = 1e-3;
    const fd = (Math.log(rho(3000 + h, -4000)) - Math.log(rho(3000 - h, -4000))) / (2 * h);
    const s = 1e-4 + fd * fd * 1e-6;
    const expected = 3000 + ((1e-6 * fd) / s) * Math.log(1.001);
    expect(out.models[0].x[0]).toBeCloseTo(expected, 6);
  });

  it("is deterministic and refuses bad inputs", () => {
    const s = scen[1];
    if (s === undefined) throw new Error("no scenario");
    const n = network(s, 0.2);
    expect(JSON.stringify(fusedPredict(s, REF, n))).toBe(JSON.stringify(fusedPredict(s, REF, n)));
    expect(() => fusedPredict(s, REF, { ...n, scenario_index: 999 })).toThrow(/scenario 999/);
    expect(() => fusedPredict(s, REF, n, { k: 0, every: 6 })).toThrow(/k > 0/);
    expect(() => fusedPredict(s, REF, n, { k: 4, every: 1.5 })).toThrow(/every/);
  });
});
