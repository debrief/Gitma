// Streaming prediction files (G2 re-score tooling): written incrementally with the same bytes as
// `predictionLines`, read back on demand, and evaluated with outputs identical to the in-memory
// path (truth as an array and predictions in Maps).
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classicalPredict,
  fitNaive,
  naivePredict,
  predictionHeader,
  predictionLines,
} from "@tma/classical";
import { canonicalJson, fileSha256, generateDataset, readDataset } from "@tma/data";
import { DEFAULT_RANGES } from "@tma/sim";
import type { ParameterRanges, Prediction, Scenario } from "@tma/types";
import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapEvaluation, pairedErrors } from "../src/bootstrap.js";
import { compareOnCommonRows } from "../src/compare.js";
import { evaluate, type PredictionSet } from "../src/evaluate.js";
import { loadPredictionSet } from "../src/load.js";
import {
  openPredictionSet,
  openPredictionWriter,
  scenarioSource,
  writePredictionStream,
} from "../src/prediction-file.js";

const tempDir = (): string => mkdtempSync(join(tmpdir(), "tma-eval-"));
const NOISY: ParameterRanges = {
  ...DEFAULT_RANGES,
  noise_sigma_rad_values: [Math.PI / 180, Math.PI / 90],
};

/** A deterministic, imperfect "model": classical rows nudged, every 7th row not converged. */
function wobble(p: Prediction): Prediction {
  return {
    ...p,
    estimator: "wobble",
    rows: p.rows.map((r, i) => ({
      ...r,
      range_m: r.range_m * (1 + 0.01 * ((i % 5) - 2)),
      speed_mps: r.speed_mps + 0.1 * ((i % 3) - 1),
      converged: r.converged && (i + p.scenario_index) % 7 !== 0,
    })),
  };
}

describe("streaming prediction files", () => {
  const dir = tempDir();
  const truthPath = join(dir, "test.f32pack");
  let scenarios: Scenario[] = [];
  const preds = new Map<string, Prediction[]>();
  const files = new Map<string, string>();

  beforeAll(() => {
    generateDataset({
      seed: 31n,
      count: 400,
      outDir: dir,
      ranges: NOISY,
      heldoutRanges: NOISY,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "0".repeat(40), generator_git_dirty: false },
    });
    scenarios = [...readDataset(truthPath).scenarios()];
    const naive = fitNaive(readDataset(join(dir, "train.f32pack")).scenarios(), "d");
    const classical = scenarios.map((s) => classicalPredict(s, "per_timestep"));
    preds.set(
      "naive",
      scenarios.map((s) => naivePredict(s, naive, "per_timestep")),
    );
    preds.set("classical", classical);
    preds.set("wobble", classical.map(wobble));
    for (const [name, ps] of preds) {
      const path = join(dir, `test.${name}.ndjson`);
      writePredictionStream(path, name, truthPath, ps);
      files.set(name, path);
    }
  }, 120_000);

  const memorySets = (): PredictionSet[] =>
    [...preds].map(([name, ps]) => ({
      label: `${name}:per_timestep`,
      estimator: name,
      byIndex: new Map(ps.map((p) => [p.scenario_index, p])),
    }));
  const fileSets = (): PredictionSet[] =>
    [...files.values()].map((f) => openPredictionSet(f, truthPath));

  it("writes the bytes predictionLines writes", () => {
    for (const [name, ps] of preds) {
      const want = `${predictionLines(predictionHeader(name, "per_timestep", truthPath), ps).join("\n")}\n`;
      expect(readFileSync(files.get(name) ?? "", "utf8") === want, name).toBe(true);
    }
  });

  it("reads back what was written, in file order, like loadPredictionSet", () => {
    for (const f of files.values()) {
      const mem = loadPredictionSet(f, truthPath);
      const disk = openPredictionSet(f, truthPath);
      expect(disk.label).toBe(mem.label);
      expect(disk.estimator).toBe(mem.estimator);
      expect(disk.byIndex.size).toBe(mem.byIndex.size);
      expect([...disk.byIndex]).toEqual([...mem.byIndex]);
      expect(disk.byIndex.get(-1)).toBeUndefined();
    }
  });

  it("evaluate, bootstrap, comparison and paired errors: identical outputs, streamed or in memory", () => {
    const opts = { points: [300, 600], curveStep: 60 };
    const truth = scenarioSource(truthPath);
    const mem = memorySets();
    const disk = fileSets();
    expect(canonicalJson(evaluate(truth, disk, opts))).toBe(
      canonicalJson(evaluate(scenarios, mem, opts)),
    );
    const b = { points: [300, 600], resamples: 100, seed: 7n, reference: "naive:per_timestep" };
    expect(canonicalJson(bootstrapEvaluation(truth, disk, b))).toBe(
      canonicalJson(bootstrapEvaluation(scenarios, mem, b)),
    );
    expect(
      canonicalJson(compareOnCommonRows(truth, disk, "classical:per_timestep", [300, 600])),
    ).toBe(
      canonicalJson(compareOnCommonRows(scenarios, mem, "classical:per_timestep", [300, 600])),
    );
    const [, cm, wm] = mem;
    const [, cd, wd] = disk;
    if (cm === undefined || wm === undefined || cd === undefined || wd === undefined)
      throw new Error("sets");
    for (const metric of ["range_rel", "course_deg", "speed_kt"] as const) {
      const a = pairedErrors(truth, wd, cd, 600, metric);
      const m = pairedErrors(scenarios, wm, cm, 600, metric);
      expect(Array.from(a.a)).toEqual(Array.from(m.a));
      expect(Array.from(a.b)).toEqual(Array.from(m.b));
      expect(a.a.length).toBeGreaterThan(0);
    }
  });

  it("re-iterates truth from the file, and scenario order is the file's", () => {
    const truth = scenarioSource(truthPath);
    const once = [...truth].map((s) => s.metadata.index);
    expect([...truth].map((s) => s.metadata.index)).toEqual(once);
    expect(once).toEqual(scenarios.map((s) => s.metadata.index));
  });

  it("refuses predictions of another truth file, a changed file, and malformed lines", () => {
    const f = files.get("wobble") ?? "";
    expect(() => openPredictionSet(f, join(dir, "train.f32pack"))).toThrow(/different truth/);
    // A copy, then modified after opening.
    const copy = join(tempDir(), "p.ndjson");
    writeFileSync(copy, readFileSync(f));
    const set = openPredictionSet(copy, truthPath);
    const first = [...set.byIndex][0]?.[0] ?? -1;
    expect(set.byIndex.get(first)?.scenario_index).toBe(first);
    utimesSync(copy, new Date(0), new Date(0));
    expect(() => set.byIndex.get(first)).toThrow(/changed since it was opened/);
    // A malformed line is reported (with its line number) when read.
    const lines = readFileSync(f, "utf8").split("\n");
    lines[2] = lines[2]?.replace('"rows":[', '"rows":[[') ?? "";
    const bad = join(tempDir(), "bad.ndjson");
    writeFileSync(bad, lines.join("\n"));
    const badSet = openPredictionSet(bad, truthPath);
    const third = scenarios[1]?.metadata.index ?? -1;
    expect(() => badSet.byIndex.get(third)).toThrow(/line 3|:3/);
    expect(() => openPredictionSet(join(tempDir(), "x"), truthPath)).toThrow();
    const empty = join(tempDir(), "empty.ndjson");
    writeFileSync(empty, "");
    expect(() => openPredictionSet(empty, truthPath)).toThrow(/empty file/);
  });

  it("indexes lines that are not canonical (scenario_index not last), blank lines and no final newline", () => {
    const ps = (preds.get("wobble") ?? []).slice(0, 3);
    const withoutIndex = (p: Prediction): Partial<Prediction> => {
      const rest: Partial<Prediction> = { ...p };
      delete rest.scenario_index;
      return rest;
    };
    const header = canonicalJson(predictionHeader("wobble", "per_timestep", truthPath));
    // Keys in another order: scenario_index first.
    const body = ps.map((p) =>
      JSON.stringify({ scenario_index: p.scenario_index, ...withoutIndex(p) }),
    );
    const path = join(tempDir(), "loose.ndjson");
    writeFileSync(path, `${header}\n\n${body.join("\n\n")}`);
    const set = openPredictionSet(path, truthPath);
    expect(set.byIndex.size).toBe(3);
    expect([...set.byIndex].map(([, p]) => p)).toEqual(ps);
  });

  it("a writer that is aborted leaves nothing; one that commits counts its lines", () => {
    const d = tempDir();
    const w = openPredictionWriter(join(d, "a.ndjson"), "x", "per_timestep", truthPath);
    for (const p of preds.get("naive") ?? []) w.write(p);
    expect(w.count).toBe(scenarios.length);
    w.abort();
    expect(() => readFileSync(join(d, "a.ndjson"))).toThrow();
    const n = writePredictionStream(join(d, "b.ndjson"), "x", truthPath, preds.get("naive") ?? []);
    expect(n).toBe(scenarios.length);
    expect(fileSha256(join(d, "b.ndjson"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
