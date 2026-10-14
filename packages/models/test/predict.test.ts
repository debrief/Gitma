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
import { buildModel, modelInputWidth, NO } from "../src/architectures.js";
import {
  loadModel,
  outputsToPrediction,
  predictScenarios,
  requireSameFeatureSet,
  requireSameNormalisation,
} from "../src/predict.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

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

describe("feature sets at predict time (T034)", () => {
  it("a derived model trains on 13 channels and scores derived files; raw files are refused, and vice versa", async () => {
    const raw = tinyFeatures(24, 3n, "raw");
    const der = tinyFeatures(24, 3n, "derived");
    const out = tempDir();
    const config = tinyConfig("instantaneous", {
      feature_set: "derived",
      max_epochs: 1,
      length_bucketing: true,
    });
    const m = await train({
      config,
      trainPath: der.train,
      valPath: der.val,
      outDir: out,
      log: () => undefined,
      source: { commit: "c".repeat(40), dirty: false },
    });
    expect(m.complete).toBe(true);
    const model = await loadModel(out);
    expect(modelInputWidth(model)).toBe(13);
    const ss = Array.from(
      { length: 24 },
      (_, i) => generateScenario(3n, i, DEFAULT_RANGES).scenario,
    );
    const fd = openFeatures(der.train);
    const fr = openFeatures(raw.train);
    try {
      expect(fd.inputChannels).toBe(13);
      expect(() => {
        requireSameFeatureSet(fd, m.config.feature_set, m.id);
      }).not.toThrow();
      expect(predictScenarios(model, fd, ss, fd.norm, m.id)).toHaveLength(24);
      expect(() => {
        requireSameFeatureSet(fr, m.config.feature_set, m.id);
      }).toThrow(/feature-set-mismatch: test-instantaneous was trained on feature set derived/);
      expect(() => predictScenarios(model, fr, ss, fr.norm, m.id)).toThrow(/13 input channels/);
      // A raw model (feature_set absent) refuses the derived file.
      const rawModel = buildModel(tinyConfig("instantaneous"));
      expect(() => {
        requireSameFeatureSet(fd, undefined, "raw-model");
      }).toThrow(/trained on feature set raw; .* holds derived/);
      expect(() => predictScenarios(rawModel, fd, ss, fd.norm, "raw-model")).toThrow(
        /10 input channels/,
      );
      rawModel.dispose();
    } finally {
      fd.close();
      fr.close();
      model.dispose();
    }
  });

  it("training refuses features of another set than the config's", async () => {
    const raw = tinyFeatures(16, 3n, "raw");
    await expect(
      train({
        config: tinyConfig("instantaneous", { feature_set: "derived", max_epochs: 1 }),
        trainPath: raw.train,
        valPath: raw.val,
        outDir: tempDir(),
        log: () => undefined,
        source: { commit: "c".repeat(40), dirty: false },
      }),
    ).rejects.toThrow(/feature-set-mismatch/);
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

  it("accepts data regenerated at a later commit (provenance-only header change) with a note", () => {
    const at = (commit: string, dirty = false): DatasetHeader => ({
      ...header,
      schema_version: "0.8.0",
      generator_git_commit: commit,
      generator_git_dirty: dirty,
    });
    const later = at("b".repeat(40));
    const earlier = at("a".repeat(40));
    const fileNorm = { ...now, train_header_digest: digest(later) };
    const modelNorm = { ...now, train_header_digest: digest(earlier) };
    const prov = { header: later, modelSchemaVersion: "0.8.0", modelSourceHeader: earlier };
    expect(requireSameNormalisation(file(fileNorm), modelNorm, "m", prov)).toMatch(
      /regenerated at b{40}.*from a{40}/,
    );
    // Without the model's source header, or with a dirty header, or other data: refused.
    const noSource = { header: prov.header, modelSchemaVersion: prov.modelSchemaVersion };
    expect(() => requireSameNormalisation(file(fileNorm), modelNorm, "m", noSource)).toThrow();
    const dirty = { ...prov, modelSourceHeader: at("a".repeat(40), true) };
    const dirtyNorm = { ...now, train_header_digest: digest(at("a".repeat(40), true)) };
    expect(() => requireSameNormalisation(file(fileNorm), dirtyNorm, "m", dirty)).toThrow();
    const otherData = { ...earlier, dataset_seed: "2" };
    const otherNorm = { ...now, train_header_digest: digest(otherData) };
    expect(() =>
      requireSameNormalisation(file(fileNorm), otherNorm, "m", {
        ...prov,
        modelSourceHeader: otherData,
      }),
    ).toThrow();
  });
});
