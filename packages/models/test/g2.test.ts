// T038: tma-g2 one-command run, tiny. Validation reads only train + validation and writes a
// diagnostic (not a verdict); test needs a committed decision once a phase B exists (SC-005).
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileSha256, generateDataset, readDataset } from "@tma/data";
import { computeNormalisation, writeFeatures } from "@tma/features";
import { DEFAULT_RANGES } from "@tma/sim";
import type { PredictionSet } from "@tma/eval";
import type {
  FeatureSet,
  GateVerdict,
  ParameterRanges,
  Prediction,
  TrainingConfig,
} from "@tma/types";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_FILE,
  featuresPath,
  type G2RunOptions,
  PAIRED_FILE,
  type PairedRecord,
  requireDecision,
  requireSameRows,
  runG2,
} from "../src/g2.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig } from "./helpers.js";

const quiet = () => undefined;
const NOISY: ParameterRanges = {
  ...DEFAULT_RANGES,
  noise_sigma_rad_values: [Math.PI / 180, Math.PI / 90],
};

const configs = (fs: FeatureSet, p: string): TrainingConfig[] => [
  tinyConfig("instantaneous", { id: `${p}lstm`, max_epochs: 1, feature_set: fs }),
  tinyConfig("time_late", { id: `${p}bilstm`, max_epochs: 1, feature_set: fs }),
  tinyConfig("causal_cnn", { id: `${p}cnn`, max_epochs: 1, feature_set: fs }),
  tinyConfig("mlp", { id: `${p}mlp`, max_epochs: 1, feature_set: fs }),
  tinyConfig("instantaneous", {
    id: `${p}lstm-shuffled`,
    max_epochs: 1,
    shuffle_labels: true,
    feature_set: fs,
  }),
];

const DECISION = {
  phase_a_experiment: "20261101-i2a-val",
  stalled: true,
  change: "feature_set: derived",
  rationale: "test",
  carried_set_rule: "B unless worse than A beyond its CI",
  decided_at: "2026-11-01T00:00:00Z",
  git_commit: "a".repeat(40),
};

describe("tma-g2 end to end (tiny)", () => {
  const data = tempDir();
  const modelsA = tempDir();
  const modelsB = tempDir();
  const noPhaseB = join(tempDir(), "absent");
  const base = (over: Partial<G2RunOptions>): G2RunOptions => ({
    data,
    models: modelsA,
    experiment: join(tempDir(), "exp"),
    split: "validation",
    commandLine: "test",
    log: quiet,
    phaseBDir: noPhaseB,
    resamples: 200,
    plan: "plan.json",
    checkPlan: () => ["ok  (stub)"],
    decisionPrecedes: () => true,
    ...over,
  });

  beforeAll(async () => {
    generateDataset({
      seed: 23n,
      count: 120,
      outDir: data,
      ranges: NOISY,
      heldoutRanges: NOISY,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "0".repeat(40), generator_git_dirty: false },
    });
    const trainSs = () => readDataset(join(data, "train.f32pack")).scenarios();
    for (const fs of ["raw", "derived"] as const) {
      const norm = computeNormalisation(trainSs(), "test", fs);
      for (const s of ["train", "validation", "test", "heldout"]) {
        const split = readDataset(join(data, `${s}.f32pack`));
        // raw under the plain name, derived under <split>.derived.features.bin (featuresPath).
        const out = join(data, fs === "raw" ? `${s}.features.bin` : `${s}.derived.features.bin`);
        writeFeatures(
          out,
          () => split.scenarios(),
          norm,
          { header: split.header, digest: fileSha256(join(data, `${s}.f32pack`)) },
          fs,
        );
      }
    }
    for (const [fs, dir, p] of [
      ["raw", modelsA, ""],
      ["derived", modelsB, "d-"],
    ] as const) {
      for (const config of configs(fs, p)) {
        await train({
          config,
          trainPath: featuresPath(data, "train", fs),
          valPath: featuresPath(data, "validation", fs),
          outDir: join(dir, config.id),
          log: quiet,
          source: { commit: "c".repeat(40), dirty: false },
        });
      }
    }
  }, 600_000);

  it("picks the feature set's own file, else the plain one", () => {
    expect(featuresPath(data, "test", "derived")).toBe(join(data, "test.derived.features.bin"));
    expect(featuresPath(data, "test", "raw")).toBe(join(data, "test.features.bin"));
  });

  it("validation: never reads the test or held-out split; writes a diagnostic, not a verdict", async () => {
    // A copy of the data folder without any test or held-out file.
    const valOnly = tempDir();
    for (const f of ["train", "validation"]) {
      for (const ext of [".f32pack", ".features.bin"]) {
        writeFileSync(join(valOnly, f + ext), readFileSync(join(data, f + ext)));
      }
    }
    const exp = join(tempDir(), "i2a-val");
    const v = await runG2(base({ data: valOnly, experiment: exp }));
    expect(v.gate).toBe("G2");
    expect(v.decided_by).toMatch(/validation diagnostic/);
    expect(v.checks.map((c) => c.name).slice(0, 6)).toEqual([
      "g2-instantaneous-range",
      "g2-instantaneous-course",
      "g2-instantaneous-speed",
      "g2-time-late-range",
      "g2-time-late-course",
      "g2-time-late-speed",
    ]);
    expect(existsSync(join(exp, "verdict.json"))).toBe(false);
    const saved = JSON.parse(readFileSync(join(exp, DIAGNOSTIC_FILE), "utf8")) as GateVerdict;
    expect(saved.result).toBe(v.result);
    for (const f of [
      "metrics.json",
      "curves.csv",
      "bootstrap.json",
      "comparison.csv",
      "manifest.json",
    ]) {
      expect(existsSync(join(exp, f)), f).toBe(true);
    }
    expect(existsSync(join(exp, "heldout"))).toBe(false);
    const metrics = readFileSync(join(exp, "metrics.csv"), "utf8");
    expect(metrics).toContain("lstm:per_timestep,sigma=1deg,zig+600s");
    expect(readFileSync(join(exp, "comparison.csv"), "utf8")).toContain("classical:per_timestep");
    const manifest = readFileSync(join(exp, "manifest.json"), "utf8");
    expect(manifest).toContain(
      "--points 300,600 --bootstrap 200 --compare-to classical:per_timestep",
    );
    expect(manifest).not.toContain("test.f32pack");
  });

  it("test without a phase B: verdict.json and the held-out split", async () => {
    const exp = join(tempDir(), "g2");
    const v = await runG2(base({ split: "test", experiment: exp }));
    expect(JSON.parse(readFileSync(join(exp, "verdict.json"), "utf8"))).toMatchObject({
      gate: "G2",
      result: v.result,
    });
    expect(existsSync(join(exp, "heldout", "metrics.json"))).toBe(true);
    expect(existsSync(join(exp, "models", "lstm", "weights.bin"))).toBe(true);
  });

  it("test with a phase B refuses without a committed, stalled decision record", async () => {
    const phaseB = tempDir(); // exists ⇒ phase B exists
    await expect(runG2(base({ split: "test", phaseBDir: phaseB }))).rejects.toThrow(
      /needs --decision/,
    );
    await expect(runG2(base({ split: "test", compareModels: modelsB }))).rejects.toThrow(
      /needs --decision/,
    );
    const d = join(tempDir(), "decision.json");
    writeFileSync(d, JSON.stringify(DECISION));
    await expect(
      runG2(base({ split: "test", phaseBDir: phaseB, decision: d, isCommitted: () => false })),
    ).rejects.toThrow(/not committed/);
    writeFileSync(d, JSON.stringify({ ...DECISION, stalled: false }));
    await expect(
      runG2(base({ split: "test", phaseBDir: phaseB, decision: d, isCommitted: () => true })),
    ).rejects.toThrow(/did not stall/);
    writeFileSync(d, JSON.stringify({ ...DECISION, extra: 1 }));
    await expect(
      runG2(base({ split: "test", phaseBDir: phaseB, decision: d, isCommitted: () => true })),
    ).rejects.toThrow();
  });

  it("test with a committed decision scores the other phase (derived) beside, ungated", async () => {
    const d = join(tempDir(), "decision.json");
    writeFileSync(d, JSON.stringify(DECISION));
    const exp = join(tempDir(), "g2b");
    rmSync(join(data, "predictions"), { recursive: true, force: true });
    await runG2(
      base({
        split: "test",
        models: modelsB,
        compareModels: modelsA,
        decision: d,
        isCommitted: () => true,
        experiment: exp,
      }),
    );
    expect(existsSync(join(exp, "verdict.json"))).toBe(true);
    expect(readFileSync(join(exp, "metrics.csv"), "utf8")).toContain("d-lstm:per_timestep");
    const other = join(exp, "other-phase");
    expect(existsSync(join(other, "verdict.json"))).toBe(false);
    const diag = JSON.parse(readFileSync(join(other, DIAGNOSTIC_FILE), "utf8")) as GateVerdict;
    expect(diag.decided_by).toMatch(/not gated/);
    expect(readFileSync(join(other, "metrics.csv"), "utf8")).toContain("lstm:per_timestep");
    expect(readFileSync(join(exp, "manifest.json"), "utf8")).toContain("feature_set: derived");
    // Spec 007 FR-006: carried / other phase, paired on the same rows, per model and metric.
    const paired = JSON.parse(readFileSync(join(exp, PAIRED_FILE), "utf8")) as PairedRecord[];
    expect(paired.length).toBeGreaterThan(0);
    expect(new Set(paired.map((r) => r.reference))).toEqual(new Set(["other-phase", "classical"]));
    for (const r of paired) {
      expect(r.slice).toBe("sigma=1deg");
      expect(r.lo).toBeLessThanOrEqual(r.hi);
      expect(["instantaneous", "time_late"]).toContain(r.variant);
    }
    // The other phase's predictions are tagged, so they never overwrite the carried set's
    // (phases A and B share model ids; G2 panel round 1).
    const preds = readdirSync(join(data, "predictions")).filter((f) => f.startsWith("test."));
    expect(preds).toContain("test.d-lstm.ndjson");
    expect(preds.filter((f) => f.startsWith("test.other-phase.")).length).toBeGreaterThan(0);
    expect(preds).not.toContain("test.lstm.ndjson");
  });

  it("test needs a plan whose digests match, and a decision committed before the weights (R19)", async () => {
    const noPlan = base({ split: "test" });
    delete noPlan.plan;
    await expect(runG2(noPlan)).rejects.toThrow(/needs --plan/);
    await expect(
      runG2(
        base({
          split: "test",
          checkPlan: () => {
            throw new Error("BAD test.f32pack");
          },
        }),
      ),
    ).rejects.toThrow(/BAD test.f32pack/);
    const d = join(tempDir(), "decision.json");
    writeFileSync(d, JSON.stringify(DECISION));
    await expect(
      runG2(
        base({
          split: "test",
          phaseBDir: tempDir(),
          decision: d,
          isCommitted: () => true,
          decisionPrecedes: () => false,
        }),
      ),
    ).rejects.toThrow(/not committed before .* was trained/);
  });

  it("validation with an other phase trained on other data: its inputs use its own normalisation (spec 007)", async () => {
    // A copy of the raw models whose manifests carry another normalisation, as models trained on
    // another dataset would (the 2c models beside iteration 3).
    const foreign = tempDir();
    cpSync(modelsA, foreign, { recursive: true });
    for (const id of readdirSync(foreign)) {
      const mp = join(foreign, id, "manifest.json");
      const m = JSON.parse(readFileSync(mp, "utf8")) as { normalisation: Record<string, unknown> };
      m.normalisation = { ...m.normalisation, train_header_digest: "f".repeat(64) };
      writeFileSync(mp, JSON.stringify(m));
    }
    const exp = join(tempDir(), "val-foreign");
    await runG2(base({ split: "validation", compareModels: foreign, experiment: exp }));
    expect(readFileSync(join(exp, "manifest.json"), "utf8")).toMatch(
      /scored on inputs built with its own normalisation/,
    );
    expect(readdirSync(join(data, "predictions")).some((f) => f.endsWith(".features.bin"))).toBe(
      true,
    );
    expect(existsSync(join(exp, PAIRED_FILE))).toBe(true);
    // The carried set never takes this path: foreign models as the carried set are refused.
    await expect(
      runG2(base({ split: "validation", models: foreign, experiment: join(tempDir(), "x") })),
    ).rejects.toThrow();
  });

  it("an other phase on a feature set the plan did not build gets its own inputs (spec 008)", async () => {
    // Derived carried models beside raw ones (iteration 4 beside iteration 3): the data folder has
    // no raw validation features, as a derived plan builds none.
    const d = tempDir();
    cpSync(data, d, { recursive: true });
    rmSync(join(d, "validation.features.bin"));
    rmSync(join(d, "predictions"), { recursive: true, force: true });
    const exp = join(tempDir(), "val-mixed");
    await runG2(base({ data: d, models: modelsB, compareModels: modelsA, experiment: exp }));
    expect(readFileSync(join(exp, "manifest.json"), "utf8")).toMatch(
      /scored on inputs built with its own normalisation/,
    );
    expect(existsSync(join(exp, PAIRED_FILE))).toBe(true);
    // The carried set never takes this path: raw carried models with no raw features fail.
    await expect(
      runG2(base({ data: d, models: modelsA, experiment: join(tempDir(), "y") })),
    ).rejects.toThrow();
  });

  it("requireSameRows refuses estimators that predict different rows", () => {
    const pred = (idx: number, ts: number[]): Prediction => ({
      record: "prediction",
      scenario_index: idx,
      estimator: "e",
      mode: "per_timestep",
      rows: ts.map((t) => ({
        timestamp_s: t,
        range_m: 1,
        course_rad: 0,
        speed_mps: 1,
        x_m: 0,
        y_m: 0,
        converged: true,
      })),
    });
    const set = (label: string, ps: Prediction[]): PredictionSet => ({
      label,
      estimator: label,
      byIndex: new Map(ps.map((p) => [p.scenario_index, p])),
    });
    const a = set("naive", [pred(1, [10, 20]), pred(2, [10])]);
    expect(() => {
      requireSameRows([a, set("m", [pred(1, [10, 20]), pred(2, [10])])], "test");
    }).not.toThrow();
    expect(() => {
      requireSameRows([a, set("m", [pred(1, [10, 20]), pred(2, [20])])], "test");
    }).toThrow(/different rows for scenario 2/);
    expect(() => {
      requireSameRows([a, set("m", [pred(1, [10, 20])])], "test");
    }).toThrow(/predicts 1 scenarios/);
  });

  it("refuses a model whose feature set has no matching features file", async () => {
    const rawOnly = tempDir();
    for (const s of ["train", "validation"]) {
      for (const ext of [".f32pack", ".features.bin"]) {
        writeFileSync(join(rawOnly, s + ext), readFileSync(join(data, s + ext)));
      }
    }
    await expect(runG2(base({ data: rawOnly, models: modelsB }))).rejects.toThrow(
      /feature-set-mismatch/,
    );
  });
});

describe("decisions bind to their plan from iteration 3 (spec 007, G0 red team)", () => {
  const plan = (dir: string, seed: string): string => {
    const p = join(dir, "configs/iter3/a/plan.json");
    mkdirSync(join(dir, "configs/iter3/a"), { recursive: true });
    writeFileSync(p, JSON.stringify({ dataset: { seed } }));
    return p;
  };
  const opts = (over: Partial<G2RunOptions>): G2RunOptions => ({
    data: "d",
    models: "m",
    experiment: "e",
    split: "test",
    commandLine: "test",
    phaseBDir: join(tempDir(), "absent"),
    isCommitted: () => true,
    ...over,
  });

  it("an iteration-3 test needs a decision, and only the one that names its plan and seed", () => {
    const dir = tempDir();
    const p = plan(dir, "204");
    expect(() => requireDecision(opts({ plan: p }))).toThrow(/needs --decision/);
    // An earlier iteration's decision (no plan) cannot unlock it.
    const old = join(dir, "old.json");
    writeFileSync(old, JSON.stringify(DECISION));
    expect(() => requireDecision(opts({ plan: p, decision: old }))).toThrow(
      /pre-registers no plan/,
    );
    const d = join(dir, "decision.json");
    writeFileSync(d, JSON.stringify({ ...DECISION, plan: "configs/iter3/b/plan.json" }));
    expect(() => requireDecision(opts({ plan: p, decision: d }))).toThrow(/pre-registers/);
    writeFileSync(d, JSON.stringify({ ...DECISION, plan: p, test_seed: "205" }));
    expect(() => requireDecision(opts({ plan: p, decision: d }))).toThrow(/test seed 205/);
    writeFileSync(d, JSON.stringify({ ...DECISION, plan: p, test_seed: "204" }));
    expect(requireDecision(opts({ plan: p, decision: d }))?.test_seed).toBe("204");
    // Validation needs nothing.
    expect(requireDecision(opts({ plan: p, split: "validation" }))).toBeUndefined();
  });

  it("binds by content and resolved path, however the plan is spelled (red team round 2)", () => {
    const dir = tempDir();
    const p = plan(dir, "204");
    const old = join(dir, "old.json");
    writeFileSync(old, JSON.stringify(DECISION));
    // A copy of the plan outside configs/iter3 is still bound: its test seed is 204.
    mkdirSync(join(dir, "elsewhere"));
    const copy = join(dir, "elsewhere", "plan.json");
    writeFileSync(copy, JSON.stringify({ dataset: { seed: "204" } }));
    expect(() => requireDecision(opts({ plan: copy, decision: old }))).toThrow(
      /pre-registers no plan/,
    );
    expect(() => requireDecision(opts({ plan: copy }))).toThrow(/needs --decision/);
    // A bound decision must name its test seed.
    const d = join(dir, "decision.json");
    writeFileSync(d, JSON.stringify({ ...DECISION, plan: p }));
    expect(() => requireDecision(opts({ plan: p, decision: d }))).toThrow(
      /must name its test seed/,
    );
    // Another spelling of the same file is the same plan.
    writeFileSync(d, JSON.stringify({ ...DECISION, plan: p, test_seed: "204" }));
    const respelled = `${dir}/configs/./iter3/a/../a/plan.json`; // not normalised (join would)
    expect(respelled).not.toBe(p);
    expect(requireDecision(opts({ plan: respelled, decision: d }))?.plan).toBe(p);
  });

  it("binds by the test data's own seed, so a forged plan copy cannot unbind it (red team round 3)", () => {
    const dir = tempDir();
    const data = join(dir, "data");
    generateDataset({
      seed: 204n,
      count: 20,
      outDir: data,
      ranges: DEFAULT_RANGES,
      heldoutRanges: DEFAULT_RANGES,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "0".repeat(40), generator_git_dirty: false },
    });
    mkdirSync(join(dir, "elsewhere"));
    const forged = join(dir, "elsewhere", "plan.json");
    writeFileSync(forged, JSON.stringify({ dataset: { seed: "100" } }));
    const old = join(dir, "old.json");
    writeFileSync(old, JSON.stringify(DECISION));
    expect(() => requireDecision(opts({ data, plan: forged, decision: old }))).toThrow(
      /pre-registers no plan/,
    );
    const d = join(dir, "decision.json");
    writeFileSync(d, JSON.stringify({ ...DECISION, plan: forged, test_seed: "205" }));
    expect(() => requireDecision(opts({ data, plan: forged, decision: d }))).toThrow(
      /test data are seed 204/,
    );
  });
});
