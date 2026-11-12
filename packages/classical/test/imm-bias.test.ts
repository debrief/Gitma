// Spec 021: the IMM's opt-in bearing-bias state. The name round-trips; both settings go together;
// without them the filter is the 5-state IMM (golden: seed1-trackers.ndjson); and with the
// geometry known, a bearing offset is taken up by the bias state. (From bearings alone a constant
// bias is nearly unobservable in these scenarios: the geometry rotates to absorb it; spec 021.)
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  type ImmParams,
  type ImmState,
  immEstimate,
  immName,
  immPredict,
  immStep,
} from "../src/imm.js";
import { parseImmName } from "../src/names.js";

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
  guardedInit: 1,
};
const DEG = Math.PI / 180;

describe("IMM bearing-bias state (spec 021)", () => {
  it("names round-trip, and both settings go together", () => {
    const p = { ...REF, biasSdDeg: 0.5, biasTauS: 1200 };
    expect(immName(p)).toBe("imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-b0.5-tb1200");
    expect(parseImmName(immName(p))).toEqual(p);
    expect(parseImmName(immName({ ...p, reportSd: true }))).toEqual({ ...p, reportSd: true });
    expect(parseImmName("imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-tb1200")).toBeNull();
    const s = generateScenario(3n, 0, PHASE4).scenario;
    expect(() => immPredict(s, { ...REF, biasSdDeg: 0.5 })).toThrow(/go together/);
    expect(() => immPredict(s, { ...REF, biasSdDeg: 0.5, biasTauS: 0 })).toThrow(/> 0/);
  });

  it("the bias state takes up a bearing offset when the geometry is known (H and sign)", () => {
    // A stationary target 5 km due north of a stationary ownship, its position known to 1 m, a
    // bias prior of 2° and bearings offset by +1°: the update must move b to about +1°.
    const n = 6;
    const x = Float64Array.from([0, 5000, 0, 0, 0, 0]);
    const p = new Float64Array(n * n);
    [1, 1, 1e-6, 1e-6, 1e-6, (2 * DEG) ** 2].forEach((v, k) => (p[n * k + k] = v));
    let st: ImmState = {
      t: 0,
      models: [
        { x: Float64Array.from(x), p: Float64Array.from(p) },
        { x: Float64Array.from(x), p: Float64Array.from(p) },
      ],
      mu: [0.9, 0.1],
    };
    const params = { ...REF, biasSdDeg: 2, biasTauS: 1e6 };
    for (let k = 1; k <= 20; k++)
      st = immStep(st, k * 10, { bearing: 1 * DEG, ox: 0, oy: 0, r2: (0.2 * DEG) ** 2 }, params);
    const b = immEstimate(st).x[5] ?? NaN;
    expect(b / DEG).toBeGreaterThan(0.9);
    expect(b / DEG).toBeLessThan(1.1);
  });
});
