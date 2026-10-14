// T038: tma-g2 one-command run, tiny. Validation reads only train + validation and writes a
// diagnostic (not a verdict); test needs a committed decision once a phase B exists (SC-005).
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
