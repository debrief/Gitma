import { createHash } from "node:crypto";
import { canonicalJson } from "@tma/data";
import { rowError } from "@tma/eval";
import {
  buildWindow,
  computeNormalisation,
  type FeatureFile,
  NT,
  openFeatures,
  ROWS,
} from "@tma/features";
import { DEFAULT_RANGES, generateScenario, noiseFree } from "@tma/sim";
import type { DatasetHeader, NormalisationConstants, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import { buildModel, NO } from "../src/architectures.js";
import { outputsToPrediction, predictScenarios, requireSameNormalisation } from "../src/predict.js";
import { tinyConfig, tinyFeatures } from "./helpers.js";

const scenarios: Scenario[] = Array.from(
  { length: 8 },
  (_, i) => generateScenario(11n, i, noiseFree(DEFAULT_RANGES)).scenario,
);
const norm = computeNormalisation(scenarios, "test");

/** The model output a perfect estimator would give: the first NO target channels. */
function truthOutputs(s: Scenario): Float32Array {
  const w = buildWindow(s, norm);
  const out = new Float32Array(ROWS * NO);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < NO; c++) out[r * NO + c] = w.targets[r * NT + c] ?? 0;
  return out;
}

describe("model outputs → predictions", () => {
  it("truth-valued outputs score (near) zero error on every post-zig row", () => {
    for (const s of scenarios) {
      const p = outputsToPrediction(s, truthOutputs(s), norm, "perfect");
      expect(p.mode).toBe("per_timestep");
      expect(p.rows).toHaveLength(s.metadata.samples - s.metadata.zig_index - 1);
      for (const row of p.rows) {
        const e = rowError(s, row);
        expect(e.gross).toBe(false);
        expect(e.range_rel).toBeLessThan(1e-5);
        expect(e.course_deg).toBeLessThan(1e-3);
        expect(e.speed_kt).toBeLessThan(1e-4);
        expect(e.position_m).toBeLessThan(1);
      }
    }
  });

  it("non-finite outputs give non-converged rows (scored gross)", () => {
    const s = scenarios[0];
    if (s === undefined) throw new Error();
    const out = truthOutputs(s);
    const i = s.metadata.zig_index + 3;
    out[i * NO] = NaN;
    out[(i + 1) * NO + 1] = Infinity;
    const p = outputsToPrediction(s, out, norm, "nan");
    const bad = p.rows.filter((r) => !r.converged).map((r) => r.timestamp_s);
    expect(bad).toHaveLength(2);
    for (const row of p.rows.filter((r) => !r.converged)) expect(rowError(s, row).gross).toBe(true);
  });

  it("runs a model over a features file in scenario order", () => {
    const data = tinyFeatures(20);
    const f = openFeatures(data.train);
    try {
      const ss = Array.from(
        { length: 20 },
        (_, i) => generateScenario(3n, i, DEFAULT_RANGES).scenario,
      );
      const model = buildModel(tinyConfig("instantaneous"));
      const ps = predictScenarios(model, f, [...ss].reverse(), f.norm, "m", 7);
      expect(ps.map((p) => p.scenario_index)).toEqual(
        [...ss].reverse().map((s) => s.metadata.index),
      );
      expect(ps.every((p) => p.estimator === "m")).toBe(true);
      model.dispose();
    } finally {
      f.close();
    }
  });
});

describe("normalisation check", () => {
  const header: DatasetHeader = {
    record: "header",
    schema_version: "0.5.0",
    generator_version: "0.1.0",
    dataset_seed: "1",
    split: "train",
    scenario_count: 8,
    index_start: 0,
    index_end: 8,
    parameter_ranges: DEFAULT_RANGES,
    redraw_count: 0,
    created_by: "test",
  };
  const digest = (h: DatasetHeader): string =>
    createHash("sha256").update(canonicalJson(h)).digest("hex");
  const file = (n: NormalisationConstants) =>
    ({ path: "f.bin", norm: n }) as unknown as FeatureFile;
  const now = computeNormalisation(scenarios, digest(header));
  const before = { ...now, train_header_digest: digest({ ...header, schema_version: "0.4.0" }) };
  const train = { header, modelSchemaVersion: "0.4.0" };

  it("accepts identical normalisation silently", () => {
    expect(requireSameNormalisation(file(now), now, "m", train)).toBeUndefined();
  });

  it("accepts a schema-version-only header change with a note", () => {
    expect(requireSameNormalisation(file(now), before, "m", train)).toMatch(/0\.4\.0 → 0\.5\.0/);
  });

  it("refuses other header changes, changed constants, or no provenance", () => {
    expect(() => requireSameNormalisation(file(now), before, "m")).toThrow(/normalisation differs/);
    const otherSeed = { ...before, train_header_digest: digest({ ...header, dataset_seed: "2" }) };
    expect(() => requireSameNormalisation(file(now), otherSeed, "m", train)).toThrow();
    const scaled = { ...before, speed_scale_mps: before.speed_scale_mps * 2 };
    expect(() => requireSameNormalisation(file(now), scaled, "m", train)).toThrow();
  });
});
