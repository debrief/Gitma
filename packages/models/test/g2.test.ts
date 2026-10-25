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
import { dirname, join } from "node:path";
import { fileSha256, generateDataset, readDataset } from "@tma/data";
import { computeNormalisation, writeFeatures } from "@tma/features";
import { DEFAULT_RANGES } from "@tma/sim";
import {
  BOOTSTRAP_SEED,
  bootstrapEvaluation,
  bootstrapMedianRatio,
  compareOnCommonRows,
  evaluate,
  loadPredictionSet,
  makeManifest,
  pairedErrors,
  type PredictionSet,
  prettyJson,
  sliceKeys,
} from "@tma/eval";
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
  G2_POINTS,
  type G2RunOptions,
  PAIRED_FILE,
  type PairedRecord,
  type Rescore,
  readReuse,
  requireDecision,
  requireSameRows,
  runG2,
} from "../src/g2.js";
import { readModelManifest } from "../src/manifest-io.js";
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

    // Streaming evaluation gives the outputs of the in-memory path: truth as an array, every
    // prediction file loaded whole into a Map (loadPredictionSet), and the paired comparison by
    // pairedErrors per pair, as before the re-score tooling.
    const truthPath = join(data, "test.f32pack");
    const scenarios = [...readDataset(truthPath).scenarios()];
    const load = (prefix: string, ids: string[]): PredictionSet[] =>
      ["naive", "classical", ...ids].map((id) =>
        loadPredictionSet(
          join(data, "predictions", `test.${id === "classical" ? "" : prefix}${id}.ndjson`),
          truthPath,
        ),
      );
    const carriedIds = readdirSync(modelsB).sort();
    const otherIds = readdirSync(modelsA).sort();
    for (const [dir, sets] of [
      [exp, load("", carriedIds)],
      [other, load("other-phase.", otherIds)],
    ] as const) {
      const ev = evaluate(scenarios, sets, { points: G2_POINTS, curveStep: 60 });
      expect(readFileSync(join(dir, "metrics.json"), "utf8")).toBe(prettyJson(ev.metrics));
      const report = bootstrapEvaluation(scenarios, sets, {
        points: G2_POINTS,
        resamples: 200,
        seed: BOOTSTRAP_SEED,
        reference: "naive:per_timestep",
      });
      expect(readFileSync(join(dir, "bootstrap.json"), "utf8")).toBe(prettyJson(report));
      expect(readFileSync(join(dir, "comparison.json"), "utf8")).toBe(
        prettyJson(compareOnCommonRows(scenarios, sets, "classical:per_timestep", G2_POINTS)),
      );
    }
    const sigma1 = scenarios.filter((x) => sliceKeys(x.metadata).includes("sigma=1deg"));
    const carried = load("", carriedIds);
    const others = load("other-phase.", otherIds);
    const byId = (sets: PredictionSet[], id: string): PredictionSet => {
      const found = sets.find((x) => x.estimator === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    const expected: unknown[] = [];
    for (const [variant, a, o] of [
      ["instantaneous", "d-lstm", "lstm"],
      ["time_late", "d-bilstm", "bilstm"],
    ] as const) {
      for (const [reference, ref, name] of [
        ["other-phase", byId(others, o), o],
        ["classical", byId(carried, "classical"), "classical"],
      ] as const) {
        for (const [metric, point] of [
          ["range_rel", 300],
          ["course_deg", 300],
          ["speed_kt", 600],
        ] as const) {
          const e = pairedErrors(sigma1, byId(carried, a), ref, point, metric);
          if (e.a.length === 0) continue;
          expected.push({
            variant,
            model: a,
            reference,
            other: name,
            slice: "sigma=1deg",
            metric,
            point_s: point,
            ...bootstrapMedianRatio(e.a, e.b, 200),
          });
        }
      }
    }
    expect(readFileSync(join(exp, PAIRED_FILE), "utf8")).toBe(prettyJson(expected));
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
    // Its own inputs were built and scored, then removed (a cache; 1.6 GB each at 100,000).
    expect(readFileSync(join(exp, "manifest.json"), "utf8")).toMatch(/removed after scoring/);
    expect(
      readdirSync(join(data, "predictions")).some((f) => /other-phase.*\.features\.bin$/.test(f)),
    ).toBe(false);
    expect(
      readdirSync(join(data, "predictions")).some((f) => /other-phase.*\.ndjson$/.test(f)),
    ).toBe(true);
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

  describe("re-score of an inconclusive gate (SRD §7, --rescore-of)", () => {
    const PANEL = "agent review panel, round 1 (no rejections; test fixture)";
    /** The weights digest each raw model's manifest records (its estimator settings). */
    const recorded = (dir: string, over: Record<string, string> = {}) =>
      readdirSync(dir)
        .sort()
        .map((d) => {
          const id = readModelManifest(join(dir, d)).id;
          return {
            name: id,
            settings: { weights_digest: over[id] ?? fileSha256(join(dir, d, "weights.bin")) },
          };
        });
    /**
     * A committed, panel-decided, inconclusive G2 experiment whose test data were another seed
     * (22; the data are 23), recording the raw models' weights digests.
     */
    const original = (
      over: {
        result?: string;
        seed?: string;
        notes?: string[];
        manifest?: boolean;
        decidedBy?: string;
        weights?: Record<string, string>;
        header?: Record<string, unknown>;
      } = {},
    ): string => {
      const dir = join(tempDir(), "20261024-g2");
      mkdirSync(dir);
      const test = join(data, "test.f32pack");
      const header = {
        ...readDataset(test).header,
        dataset_seed: over.seed ?? "22",
        ...over.header,
      };
      if (over.manifest !== false) {
        const m = makeManifest(
          "20261024-g2",
          [{ path: test, header }],
          recorded(modelsA, over.weights),
          ["tma-g2 …", ...(over.notes ?? [])],
        );
        writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
      }
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({
          gate: "G2",
          result: over.result ?? "inconclusive",
          checks: [],
          decided_by: over.decidedBy ?? PANEL,
        }),
      );
      return dir;
    };
    /** A plan whose fresh test split is the data's own seed (23), count 1,000. */
    const freshPlan = (seed = "23", digest = "PLACEHOLDER"): string => {
      const p = join(tempDir(), "plan.json");
      writeFileSync(
        p,
        JSON.stringify({ dataset: { seed: "205", fresh_test: { seed, count: 1000, digest } } }),
      );
      return p;
    };
    const digests = (dir: string) =>
      readdirSync(dir)
        .sort()
        .map((d) => ({
          model: readModelManifest(join(dir, d)).id,
          weights_sha256: fileSha256(join(dir, d, "weights.bin")),
          manifest_sha256: fileSha256(join(dir, d, "manifest.json")),
          model_json_sha256: fileSha256(join(dir, d, "model.json")),
        }));
    const decision = (over: Record<string, unknown>): string => {
      const d = join(tempDir(), "decision.json");
      writeFileSync(
        d,
        JSON.stringify({ ...DECISION, test_seed: "23", fresh_test_count: 1000, ...over }),
      );
      return d;
    };
    let fresh = 0;
    /** As committed with the decision: the same plan, its fresh-test digest still a placeholder. */
    const asPreRegistered = (_: string, plan: string): string => {
      const p = JSON.parse(readFileSync(plan, "utf8")) as {
        dataset: { fresh_test: { digest: string } };
      };
      p.dataset.fresh_test.digest = "PLACEHOLDER";
      return JSON.stringify(p);
    };
    /** Options for a valid re-score of `orig` with the raw models; `over` breaks one thing. */
    const rescore = (
      orig: string,
      over: Partial<G2RunOptions> = {},
      record: Record<string, unknown> = {},
    ): G2RunOptions => {
      const plan = freshPlan();
      return base({
        split: "test",
        plan,
        rescoreOf: orig,
        decision: decision({
          plan,
          rescore_of: orig,
          model_digests: digests(modelsA),
          ...record,
        }),
        isCommitted: () => true,
        decisionPrecedes: () => {
          throw new Error("a re-score never asks for training ancestry");
        },
        planAtDecision: asPreRegistered,
        decisionBeforePlanPin: () => true,
        experiment: join(dirname(orig), `2026102${String(fresh++ % 10)}-rescore-${String(fresh)}`),
        ...over,
      });
    };

    it("scores the fresh test split only, bound by file digests, and says so", async () => {
      const orig = original();
      const exp = join(dirname(orig), "20261025-rescore");
      // The fresh digest was pinned after the decision: the plan's only allowed change.
      const plan = freshPlan("23", "a".repeat(64));
      const o = rescore(orig, { experiment: exp, compareModels: modelsB, plan }, { plan });
      const v = await runG2(o);
      const marker = JSON.parse(readFileSync(join(exp, "rescore.json"), "utf8")) as Record<
        string,
        string
      >;
      expect(Object.keys(marker)).toEqual(["decision", "git_commit", "rescore_of", "started_at"]);
      expect(marker.rescore_of).toBe(orig);
      expect(JSON.parse(readFileSync(join(exp, "verdict.json"), "utf8"))).toMatchObject({
        gate: "G2",
        result: v.result,
      });
      expect(existsSync(join(exp, "other-phase", DIAGNOSTIC_FILE))).toBe(true);
      expect(existsSync(join(exp, PAIRED_FILE))).toBe(true);
      // The held-out split is the re-scored gate's: not scored again.
      expect(existsSync(join(exp, "heldout"))).toBe(false);
      const manifest = JSON.parse(readFileSync(join(exp, "manifest.json"), "utf8")) as {
        command_lines: string[];
        datasets: { header: { split: string } }[];
      };
      expect(manifest.command_lines).toContain(`# rescore_of: ${orig}`);
      expect(manifest.command_lines.join("\n")).toMatch(/held-out split not scored: a re-score/);
      expect(manifest.command_lines.join("\n")).toMatch(
        /re-score model lstm: weights.bin sha256 [0-9a-f]{64}, manifest.json [0-9a-f]{64}, model.json [0-9a-f]{64}/,
      );
      expect(manifest.datasets.map((d) => d.header.split)).toEqual(["train", "test"]);
      expect(readFileSync(join(exp, "seeds.txt"), "utf8")).not.toContain("heldout");
      // One scoring: the same folder is refused once its verdict exists.
      await expect(runG2(rescore(orig, { experiment: exp }))).rejects.toThrow(
        /verdict.json exists: a re-score is scored once/,
      );
      // Nor into another folder beside it: its marker records the re-score.
      await expect(runG2(rescore(orig))).rejects.toThrow(/20261025-rescore already re-scored/);
      // A re-score is never re-scored, even if its verdict were inconclusive.
      const again = join(tempDir(), "again");
      mkdirSync(again);
      cpSync(join(exp, "manifest.json"), join(again, "manifest.json"));
      writeFileSync(
        join(again, "verdict.json"),
        JSON.stringify({ gate: "G2", result: "inconclusive", checks: [], decided_by: PANEL }),
      );
      await expect(runG2(rescore(again))).rejects.toThrow(/itself a re-score/);
    });

    it("finishes an aborted re-score from committed, sha256-verified predictions (--reuse-predictions)", async () => {
      const orig = original();
      const exp = join(dirname(orig), "20261025-rescore");
      // The other phase is trained on other data, so its inputs are its own (spec 007).
      const foreign = tempDir();
      cpSync(modelsA, foreign, { recursive: true });
      for (const id of readdirSync(foreign)) {
        const mp = join(foreign, id, "manifest.json");
        const m = JSON.parse(readFileSync(mp, "utf8")) as {
          normalisation: Record<string, unknown>;
        };
        m.normalisation = { ...m.normalisation, train_header_digest: "f".repeat(64) };
        writeFileSync(mp, JSON.stringify(m));
      }
      const first = await runG2(rescore(orig, { experiment: exp, compareModels: foreign }));
      const outputs = ["metrics.json", "bootstrap.json", "curves.csv", PAIRED_FILE];
      const hashes = outputs.map((f) => fileSha256(join(exp, f)));
      const pred = join(data, "predictions");
      // This run's files: naive, classical and each model, for both sets.
      const ids = readdirSync(modelsA).map((d) => readModelManifest(join(modelsA, d)).id);
      const files = [
        "test.naive.ndjson",
        "test.classical.ndjson",
        "test.other-phase.naive.ndjson",
        ...ids.flatMap((id) => [`test.${id}.ndjson`, `test.other-phase.${id}.ndjson`]),
      ];
      expect(files.every((f) => existsSync(join(pred, f)))).toBe(true);
      const relisted = files.find((f) => f.startsWith("test.other-phase.") && !f.includes("naive"));
      expect(relisted).toBeDefined();
      // Aborted before its verdict: the folder and its marker go under a note, as in decision.md.
      rmSync(exp, { recursive: true });
      const list = (over: Record<string, string> = {}): string => {
        const f = join(tempDir(), "reuse.json");
        const m = Object.fromEntries(
          files.filter((x) => x !== relisted).map((x) => [x, fileSha256(join(pred, x))]),
        );
        writeFileSync(f, JSON.stringify({ ...m, ...over }));
        return f;
      };
      const lines: string[] = [];
      const reuse = list();
      const again = await runG2(
        rescore(orig, {
          experiment: exp,
          compareModels: foreign,
          reusePredictions: reuse,
          log: (l) => lines.push(l),
        }),
      );
      expect(again.result).toBe(first.result);
      expect(outputs.map((f) => fileSha256(join(exp, f)))).toEqual(hashes);
      // Every listed file once, and classical (shared by both sets) twice.
      expect(lines.filter((l) => l.includes("(sha256 verified)"))).toHaveLength(files.length);
      // The unlisted file is predicted again, on inputs it builds and removes.
      expect(lines.some((l) => l.includes("predicting") && l.includes("other-phase"))).toBe(true);
      expect(readdirSync(pred).some((f) => f.endsWith(".features.bin"))).toBe(false);
      expect(readFileSync(join(exp, "manifest.json"), "utf8")).toMatch(
        /predictions reused from an earlier attempt, each sha256-verified against/,
      );
      // A listed file that differs, or is missing, is refused, never predicted over.
      rmSync(exp, { recursive: true });
      await expect(
        runG2(
          rescore(orig, {
            experiment: exp,
            compareModels: foreign,
            reusePredictions: list({ "test.classical.ndjson": "0".repeat(64) }),
          }),
        ),
      ).rejects.toThrow(/its sha256 differs/);
      // A listed file the run never uses is refused: a stale or mistyped list.
      rmSync(exp, { recursive: true, force: true });
      await expect(
        runG2(
          rescore(orig, {
            experiment: exp,
            compareModels: foreign,
            reusePredictions: list({ "test.absent.ndjson": "0".repeat(64) }),
          }),
        ),
      ).rejects.toThrow(/listed but not part of this run: test.absent.ndjson/);
      // A listed file that is missing is refused (here, in a copy of the data).
      const d = tempDir();
      cpSync(data, d, { recursive: true });
      rmSync(join(d, "predictions", "test.classical.ndjson"));
      rmSync(exp, { recursive: true, force: true });
      await expect(
        runG2(rescore(orig, { data: d, experiment: exp, reusePredictions: reuse })),
      ).rejects.toThrow(/does not exist/);
      // A reused file must be its model's, whatever its name: here another model's predictions.
      const [a, b] = ids;
      if (a !== undefined && b !== undefined) {
        cpSync(join(pred, `test.${a}.ndjson`), join(d, "predictions", `test.${b}.ndjson`));
        cpSync(
          join(pred, "test.classical.ndjson"),
          join(d, "predictions", "test.classical.ndjson"),
        );
        const swapped = join(tempDir(), "swapped.json");
        writeFileSync(
          swapped,
          JSON.stringify({
            [`test.${b}.ndjson`]: fileSha256(join(d, "predictions", `test.${b}.ndjson`)),
          }),
        );
        rmSync(exp, { recursive: true, force: true });
        await expect(
          runG2(rescore(orig, { data: d, experiment: exp, reusePredictions: swapped })),
        ).rejects.toThrow(new RegExp(`holds estimator ${a}, not ${b}`));
      }
      // Only in re-score mode, from a committed list of file names and sha256s.
      const o = rescore(orig, { experiment: join(tempDir(), "x"), reusePredictions: reuse });
      expect(() => readReuse(o, undefined)).toThrow(/only to finish an aborted re-score/);
      const r = { of: orig } as Rescore;
      expect(() => readReuse({ ...o, isCommitted: () => false }, r)).toThrow(/must be committed/);
      for (const bad of [{ "../x.ndjson": "0".repeat(64) }, { "x.ndjson": "abc" }, ["x"]]) {
        const f = join(tempDir(), "bad.json");
        writeFileSync(f, JSON.stringify(bad));
        expect(() => readReuse({ ...o, reusePredictions: f }, r)).toThrow(/--reuse-predictions/);
      }
    });

    it("allows one re-score per gate: a sibling that already re-scored it is refused", async () => {
      const orig = original();
      const sibling = join(dirname(orig), "20261025-rescore");
      mkdirSync(sibling);
      writeFileSync(
        join(sibling, "manifest.json"),
        JSON.stringify({ command_lines: [`# rescore_of: ${orig}`] }),
      );
      await expect(
        runG2(rescore(orig, { experiment: join(dirname(orig), "20261026-second") })),
      ).rejects.toThrow(/already re-scored/);
    });

    it("the decision's rescore_of alone selects re-score mode", async () => {
      const orig = original({ result: "pass" });
      const o = rescore(orig);
      delete o.rescoreOf;
      await expect(runG2(o)).rejects.toThrow(/only an inconclusive gate is re-scored/);
    });

    it("refuses a gate that was not inconclusive, or has no verdict or manifest", async () => {
      for (const result of ["pass", "fail"]) {
        await expect(runG2(rescore(original({ result })))).rejects.toThrow(
          new RegExp(`is ${result}: only an inconclusive gate is re-scored`),
        );
      }
      const noVerdict = original();
      rmSync(join(noVerdict, "verdict.json"));
      await expect(runG2(rescore(noVerdict))).rejects.toThrow(/verdict.json does not exist/);
      await expect(runG2(rescore(original({ manifest: false })))).rejects.toThrow(
        /manifest.json does not exist/,
      );
      await expect(runG2(rescore(join(tempDir(), "absent")))).rejects.toThrow(/does not exist/);
    });

    it("refuses the re-scored gate's own test seed, and a re-score of a re-score", async () => {
      await expect(runG2(rescore(original({ seed: "23" })))).rejects.toThrow(
        /test seed 23 is the re-scored gate's: a re-score needs a fresh seed/,
      );
      await expect(
        runG2(rescore(original({ notes: ["# rescore_of: experiments/20261001-g2"] }))),
      ).rejects.toThrow(/itself a re-score: SRD §7 allows one re-score, then fails/);
    });

    it("refuses model digests that differ from the carried weights or miss a model", async () => {
      const orig = original();
      const good = digests(modelsA);
      const [first, ...rest] = good;
      if (first === undefined) throw new Error("no models");
      await expect(
        runG2(
          rescore(
            orig,
            {},
            { model_digests: [{ ...first, weights_sha256: "0".repeat(64) }, ...rest] },
          ),
        ),
      ).rejects.toThrow(
        new RegExp(`${first.model}: weights.bin is sha256 [0-9a-f]{64}, the decision names 0{64}`),
      );
      await expect(runG2(rescore(orig, {}, { model_digests: rest }))).rejects.toThrow(
        new RegExp(`must name exactly the carried models .*; missing ${first.model}`),
      );
      await expect(
        runG2(rescore(orig, {}, { model_digests: [...good, { ...first, model: "extra" }] })),
      ).rejects.toThrow(/not carried extra/);
      await expect(runG2(rescore(orig, {}, { model_digests: [first, ...good] }))).rejects.toThrow(
        /names a model twice/,
      );
      await expect(runG2(rescore(orig, {}, { model_digests: null }))).rejects.toThrow(
        /must name exactly the carried models/,
      );
      // Every file as the decision names, but weights.bin not as its own manifest records.
      const copy = tempDir();
      cpSync(modelsA, copy, { recursive: true });
      const id = readdirSync(copy).sort()[0] ?? "";
      const mp = join(copy, id, "manifest.json");
      const m = JSON.parse(readFileSync(mp, "utf8")) as { weights_digest: string };
      m.weights_digest = "2".repeat(64);
      writeFileSync(mp, JSON.stringify(m));
      await expect(
        runG2(rescore(orig, { models: copy }, { model_digests: digests(copy) })),
      ).rejects.toThrow(/its manifest says 2{64}/);
    });

    it("refuses a decision that does not name this re-score, plan or seed", async () => {
      const orig = original();
      await expect(runG2(rescore(orig, {}, { rescore_of: null }))).rejects.toThrow(
        /the decision names no re-score/,
      );
      await expect(runG2(rescore(orig, {}, { rescore_of: original() }))).rejects.toThrow(
        /the decision re-scores .*, not /,
      );
      await expect(runG2(rescore(orig, {}, { plan: "configs/iter4/b/plan.json" }))).rejects.toThrow(
        /pre-registers configs\/iter4\/b\/plan.json/,
      );
      const o = rescore(orig);
      await expect(runG2({ ...o, plan: freshPlan("24") })).rejects.toThrow(/tests seed 24/);
      const noFresh = join(tempDir(), "plan.json");
      writeFileSync(noFresh, JSON.stringify({ dataset: { seed: "23" } }));
      await expect(runG2(rescore(orig, { plan: noFresh }, { plan: noFresh }))).rejects.toThrow(
        /has no dataset.fresh_test seed/,
      );
      // A test seed other than the data's is refused (requireDecision or the re-score check).
      const p24 = freshPlan("24");
      await expect(
        runG2(rescore(orig, { plan: p24 }, { plan: p24, test_seed: "24" })),
      ).rejects.toThrow(/test data are seed 23/);
    });

    it("binds the re-scored gate: committed, panel-decided, and the weights it scored", async () => {
      await expect(
        runG2(rescore(original(), { isCommitted: (f) => !f.endsWith("verdict.json") })),
      ).rejects.toThrow(/verdict.json is not committed/);
      await expect(
        runG2(rescore(original(), { isCommitted: (f) => !f.endsWith("manifest.json") })),
      ).rejects.toThrow(/manifest.json is not committed/);
      await expect(
        runG2(rescore(original({ decidedBy: "harness (pending agent panel review)" }))),
      ).rejects.toThrow(/not an agent panel round/);
      const id = readModelManifest(join(modelsA, readdirSync(modelsA).sort()[0] ?? "")).id;
      await expect(runG2(rescore(original({ weights: { [id]: "3".repeat(64) } })))).rejects.toThrow(
        new RegExp(`${id}: weights.bin is sha256 [0-9a-f]{64}, .* recorded 3{64}`),
      );
    });

    it("binds every model file: manifest.json and model.json digests", async () => {
      const orig = original();
      const [first, ...rest] = digests(modelsA);
      if (first === undefined) throw new Error("no models");
      for (const [key, file] of [
        ["manifest_sha256", "manifest.json"],
        ["model_json_sha256", "model.json"],
      ] as const) {
        await expect(
          runG2(
            rescore(orig, {}, { model_digests: [{ ...first, [key]: "4".repeat(64) }, ...rest] }),
          ),
        ).rejects.toThrow(
          new RegExp(`${first.model}: ${file} is sha256 [0-9a-f]{64}, the decision names 4{64}`),
        );
      }
      // A decision of schema 0.11.0 (weights only) no longer parses.
      await expect(
        runG2(
          rescore(
            orig,
            {},
            { model_digests: [{ model: first.model, weights_sha256: first.weights_sha256 }] },
          ),
        ),
      ).rejects.toThrow();
    });

    it("binds the plan: fresh_test_count, content as pre-registered, clean test data", async () => {
      const orig = original();
      await expect(runG2(rescore(orig, {}, { fresh_test_count: 999 }))).rejects.toThrow(
        /fresh_test_count 999, the plan's dataset.fresh_test.count is 1000/,
      );
      await expect(runG2(rescore(orig, {}, { fresh_test_count: null }))).rejects.toThrow(
        /fresh_test_count/,
      );
      await expect(runG2(rescore(orig, { planAtDecision: () => undefined }))).rejects.toThrow(
        /did not exist at the commit that added/,
      );
      // Any change but the fresh digest since the decision was committed is refused.
      const changed = (_: string, plan: string): string => {
        const p = JSON.parse(asPreRegistered(_, plan)) as { dataset: { seed: string } };
        p.dataset.seed = "201";
        return JSON.stringify(p);
      };
      await expect(runG2(rescore(orig, { planAtDecision: changed }))).rejects.toThrow(
        /changed since .* in more than dataset.fresh_test.digest/,
      );
      // Test data generated from a dirty tree.
      const dirty = tempDir();
      generateDataset({
        seed: 23n,
        count: 120,
        outDir: dirty,
        ranges: NOISY,
        heldoutRanges: NOISY,
        format: "f32pack",
        createdBy: "test",
        provenance: { generator_git_commit: "0".repeat(40), generator_git_dirty: true },
      });
      await expect(runG2(rescore(orig, { data: dirty }))).rejects.toThrow(
        /generated from a working tree with changes/,
      );
    });

    it("round 3: model files of record, the decision before the pin, the same problem", async () => {
      // An edited copy outside the repository, or an untracked folder, is refused.
      for (const file of ["weights.bin", "manifest.json", "model.json"]) {
        await expect(
          runG2(rescore(original(), { isCommitted: (f) => !f.endsWith(join("lstm", file)) })),
        ).rejects.toThrow(new RegExp(`lstm/${file.replace(".", "\\.")} is not committed`));
      }
      await expect(
        runG2(rescore(original(), { decisionBeforePlanPin: () => false })),
      ).rejects.toThrow(/was last changed after .* \(the digest pin\)/);
      const ranges = readDataset(join(data, "test.f32pack")).header.parameter_ranges;
      await expect(
        runG2(
          rescore(
            original({
              header: { parameter_ranges: { ...ranges, noise_sigma_rad_values: [0.001] } },
            }),
          ),
        ),
      ).rejects.toThrow(/parameter_ranges differs from the re-scored gate's test split/);
      await expect(
        runG2(rescore(original({ header: { generator_version: "0.2.0" } }))),
      ).rejects.toThrow(/generator_version differs from the re-scored gate's test split/);
    });

    it("one re-score per gate: beside the gate, no marker, no second decision, no --allow-dirty", async () => {
      const orig = original();
      await expect(
        runG2(rescore(orig, { experiment: join(tempDir(), "elsewhere") })),
      ).rejects.toThrow(/is not beside/);
      // A folder holding only a marker (a re-score that stopped) is not scored again.
      const stopped = join(dirname(orig), "20261025-stopped");
      mkdirSync(stopped);
      writeFileSync(join(stopped, "rescore.json"), JSON.stringify({ rescore_of: orig }));
      await expect(runG2(rescore(orig, { experiment: stopped }))).rejects.toThrow(
        /already holds a re-score/,
      );
      await expect(runG2(rescore(orig))).rejects.toThrow(/20261025-stopped already re-scored/);
      // Another committed decision beside the gate naming the same re-score.
      const orig2 = original();
      const otherDecision = join(dirname(orig2), "20261024-another-decision");
      mkdirSync(otherDecision);
      writeFileSync(
        join(otherDecision, "decision.json"),
        JSON.stringify({ ...DECISION, rescore_of: orig2 }),
      );
      await expect(runG2(rescore(orig2))).rejects.toThrow(/also names the re-score of/);
      await expect(runG2(rescore(original(), { allowDirty: true }))).rejects.toThrow(
        /clean, committed tree only/,
      );
    });

    it("refuses outside a committed test run with a decision", async () => {
      const orig = original();
      await expect(runG2(rescore(orig, { split: "validation" }))).rejects.toThrow(
        /scores the test split only/,
      );
      const noDecision = rescore(orig);
      delete noDecision.decision;
      await expect(runG2(noDecision)).rejects.toThrow(/needs --decision/);
      await expect(runG2(rescore(orig, { isCommitted: () => false }))).rejects.toThrow(
        /not committed/,
      );
    });
  });

  it("preflight: refuses before scoring anything when a split's features are not built", async () => {
    const d = tempDir();
    cpSync(data, d, { recursive: true });
    rmSync(join(d, "heldout.features.bin"));
    rmSync(join(d, "predictions"), { recursive: true, force: true });
    const exp = join(tempDir(), "pre");
    await expect(runG2(base({ data: d, split: "test", experiment: exp }))).rejects.toThrow(
      /not built, so nothing was scored: .*heldout.features.bin \(raw features\)/,
    );
    expect(existsSync(exp)).toBe(false);
    expect(existsSync(join(d, "predictions"))).toBe(false);
    // Only a re-score skips the held-out split (FR-019).
    await expect(
      runG2(base({ data: d, split: "test", experiment: exp, heldout: false })),
    ).rejects.toThrow(/only a re-score skips it/);
    expect(existsSync(exp)).toBe(false);
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
