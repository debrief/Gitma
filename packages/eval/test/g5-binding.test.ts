// tma-g5 binding gaps closed by spec 015: re-computed samples (FR-001), data that postdate the
// decision (FR-002) and "scored once" across experiments (FR-003). Each check has a passing and a
// refusing case.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileDigest,
  fusedPredict,
  type ImmParams,
  immName,
  immPredict,
  trackerHybrid,
} from "@tma/classical";
import { readDataset, runCli } from "@tma/data";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { priorG5Scorings, requireG5Binding, requireScoredOnce } from "../src/cli-g5.js";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "../src/prediction-file.js";
import {
  digestCache,
  RECOMPUTE_SCENARIOS,
  requireRecomputed,
  sampleScenarios,
} from "../src/recompute.js";
import { truthRow } from "./helpers.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const configs = new URL("../../../configs/", import.meta.url).pathname;
const REF: ImmParams = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
};
const NET = "lstm-gaussian";

describe("tma-g5 bindings (spec 015)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-g5-bind-"));
  expect(
    runCli(generate, [
      "--seed",
      "15",
      "--count",
      "120",
      "--ranges",
      join(configs, "phase4-ranges.json"),
      "--heldout-ranges",
      join(configs, "phase4-heldout-ranges.json"),
      "--out",
      dir,
      "--allow-dirty",
    ]),
  ).toBe(0);
  const truth = join(dir, "test.f32pack");
  const scenarios: Scenario[] = Array.from(scenarioSource(truth));
  const sample = scenarios.map((s) => s.metadata.index);

  /** A prediction file of `make(s)` per scenario, with the given provenance. */
  const write = (
    name: string,
    estimator: string,
    make: (s: Scenario) => Prediction,
    provenance: Parameters<typeof openPredictionWriter>[4] = {},
  ): string => {
    const out = join(dir, name);
    const w = openPredictionWriter(out, estimator, "per_timestep", truth, provenance);
    for (const s of scenarios) w.write(make(s));
    w.commit();
    return out;
  };
  /** A stand-in network: truth rows, slightly off, with a stated log-range sd. */
  const network = (s: Scenario): Prediction => {
    const rows: PredictionRow[] = [];
    for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
      const r = truthRow(s, i);
      rows.push({
        ...r,
        range_m: r.range_m * 1.05,
        course_rad: r.course_rad + 0.1,
        log_range_sd: 0.1,
      });
    }
    return {
      record: "prediction",
      scenario_index: s.metadata.index,
      estimator: NET,
      mode: "per_timestep",
      rows,
    };
  };
  const weights = createHash("sha256").update("w").digest("hex");
  const t2Path = write("t2.ndjson", NET, network, { model_weights_sha256: weights });
  const immPath = write("imm.ndjson", immName(REF), (s) => immPredict(s, REF));
  const t2 = openPredictionSet(t2Path, truth);
  const imm = openPredictionSet(immPath, truth);
  const fusedEst = `fused-${NET}-${immName(REF)}-k4-m6`;
  const fusedPath = write(
    "fused.ndjson",
    fusedEst,
    (s) => fusedPredict(s, REF, network(s), { k: 4, every: 6 }),
    { inputs: [{ estimator: NET, sha256: fileDigest(t2Path) }] },
  );
  const hybridEst = `hybrid-${NET}-${immName(REF)}-c45`;
  const hybridPath = write(
    "hybrid.ndjson",
    hybridEst,
    (s) => trackerHybrid(immPredict(s, REF), network(s), 45),
    {
      inputs: [
        { estimator: immName(REF), sha256: fileDigest(immPath) },
        { estimator: NET, sha256: fileDigest(t2Path) },
      ],
    },
  );

  describe("FR-001 re-computed sample", () => {
    it("draws a seeded sample of distinct scenarios, ascending", () => {
      const pool = Array.from({ length: 1000 }, (_, i) => 3 * i);
      const a = sampleScenarios(pool);
      expect(a).toHaveLength(RECOMPUTE_SCENARIOS);
      expect(new Set(a).size).toBe(a.length);
      expect([...a].sort((x, y) => x - y)).toEqual(a);
      expect(sampleScenarios(pool)).toEqual(a);
      expect(sampleScenarios(pool, 200, 1n)).not.toEqual(a);
      expect(sampleScenarios([5, 1, 1], 200)).toEqual([1, 5]);
    });

    it("passes the reference IMM, the fused tracker and the tracker hybrid as made", () => {
      const fused = openPredictionSet(fusedPath, truth);
      const hybrid = openPredictionSet(hybridPath, truth);
      const given = [fused, hybrid, imm, t2];
      const d = digestCache();
      expect(requireRecomputed(imm, given, scenarios, sample, d)?.scenarios).toBe(sample.length);
      expect(requireRecomputed(fused, given, scenarios, sample, d)?.estimator).toBe(fusedEst);
      expect(requireRecomputed(hybrid, given, scenarios, sample, d)?.estimator).toBe(hybridEst);
      // A network's own file is bound by its weights, not re-computed.
      expect(requireRecomputed(t2, given, scenarios, sample, d)).toBeNull();
    });

    it("refuses a file whose rows were not made with the settings its name declares", () => {
      // Fused rows made with k = 2, under the k = 4 name.
      const k2 = openPredictionSet(
        write(
          "fused-k2.ndjson",
          fusedEst,
          (s) => fusedPredict(s, REF, network(s), { k: 2, every: 6 }),
          { inputs: [{ estimator: NET, sha256: fileDigest(t2Path) }] },
        ),
        truth,
      );
      expect(() => requireRecomputed(k2, [k2, imm, t2], scenarios, sample, digestCache())).toThrow(
        /differs from fused-.* re-computed from its declared settings/,
      );
      // A reference whose rows came from other IMM settings.
      const other = openPredictionSet(
        write("imm-other.ndjson", immName(REF), (s) => immPredict(s, { ...REF, rScale: 2 })),
        truth,
      );
      expect(() => requireRecomputed(other, [other], scenarios, sample, digestCache())).toThrow(
        /differs/,
      );
      // A hybrid at θ = 30° under the 45° name.
      const h30 = openPredictionSet(
        write(
          "hybrid-30.ndjson",
          hybridEst,
          (s) => trackerHybrid(immPredict(s, REF), network(s), 30),
          {
            inputs: [
              { estimator: immName(REF), sha256: fileDigest(immPath) },
              { estimator: NET, sha256: fileDigest(t2Path) },
            ],
          },
        ),
        truth,
      );
      expect(() =>
        requireRecomputed(h30, [h30, imm, t2], scenarios, sample, digestCache()),
      ).toThrow(/differs/);
    });

    it("refuses one changed byte in one sampled scenario", () => {
      const lines = readFileSync(immPath, "utf8").split("\n");
      lines[3] = (lines[3] ?? "").replace(
        /"range_m":(\d)/,
        (_m, d: string) => `"range_m":${String((Number(d) + 1) % 10)}`,
      );
      const p = join(dir, "imm-tampered.ndjson");
      writeFileSync(p, lines.join("\n"));
      const t = openPredictionSet(p, truth);
      expect(() => requireRecomputed(t, [t], scenarios, sample, digestCache())).toThrow(/differs/);
    });

    it("refuses names it cannot re-run, and inputs not given", () => {
      const anon = openPredictionSet(
        write("anon.ndjson", "imm-ref", (s) => immPredict(s, REF)),
        truth,
      );
      expect(() => requireRecomputed(anon, [anon], scenarios, sample, digestCache())).toThrow(
        /declares no settings the gate can re-compute/,
      );
      const fused = openPredictionSet(fusedPath, truth);
      expect(() =>
        requireRecomputed(fused, [fused, imm], scenarios, sample, digestCache()),
      ).toThrow(/is not among the files given/);
      const bad = openPredictionSet(
        write(
          "fused-bad.ndjson",
          `fused-${NET}-imm-x-k4-m6`,
          (s) => fusedPredict(s, REF, network(s)),
          {
            inputs: [{ estimator: NET, sha256: fileDigest(t2Path) }],
          },
        ),
        truth,
      );
      expect(() => requireRecomputed(bad, [bad, t2], scenarios, sample, digestCache())).toThrow(
        /not a canonical fused-tracker name/,
      );
    });
  });

  describe("FR-002 data postdate the decision", () => {
    const decision = join(dir, "decision.json");
    const frozen = join(dir, "frozen");
    mkdirSync(frozen, { recursive: true });
    writeFileSync(join(frozen, "manifest.json"), JSON.stringify({ id: NET }));
    writeFileSync(join(frozen, "model.json"), "{}");
    writeFileSync(join(frozen, "weights.bin"), "w");
    const sha = (f: string): string => fileDigest(join(frozen, f));
    writeFileSync(
      decision,
      JSON.stringify({
        phase_a_experiment: "x",
        stalled: false,
        change: "x",
        rationale: "x",
        carried_set_rule: "x",
        decided_at: "2026-11-02T00:00:00Z",
        git_commit: "abc",
        plans: ["configs/phase4/f/plan.json"],
        test_seed: readDataset(truth).header.dataset_seed,
        reference_estimator: immName(REF),
        carried_models: [fusedEst],
        model_digests: [
          {
            model: NET,
            weights_sha256: sha("weights.bin"),
            manifest_sha256: sha("manifest.json"),
            model_json_sha256: sha("model.json"),
          },
        ],
      }),
    );
    const binding = {
      decisionPath: decision,
      planPaths: ["configs/phase4/f/plan.json"],
      modelDirs: [frozen],
      truthPath: truth,
      trackers: [fusedEst],
      reference: immName(REF),
    };
    const header = readDataset(truth).header;
    const deps = (commit: string | null, dirty = false) => ({
      isCommitted: () => true,
      checkDigests: () => undefined,
      // The decision was added at commit "decided"; "after" descends from it, "before" does not.
      precedes: (_d: string, c: string) => c === "decided" || c === "after",
      truthHeader: () => ({ ...header, generator_git_dirty: dirty, generator_git_commit: commit }),
    });

    it("passes data generated at the decision's commit or after it (frozen-model path)", () => {
      expect(() => requireG5Binding(binding, deps("after"))).not.toThrow();
      expect(() => requireG5Binding(binding, deps("decided"))).not.toThrow();
    });

    it("refuses data generated before the decision, or with no commit, on the frozen-model path", () => {
      expect(() => requireG5Binding(binding, deps("before"))).toThrow(
        /generated at commit before, which does not descend from the commit that added/,
      );
      expect(() => requireG5Binding(binding, deps(null))).toThrow(/does not descend/);
      expect(() => requireG5Binding(binding, deps("after", true))).toThrow(/dirty/);
    });
  });

  describe("FR-003 scored once across experiments", () => {
    const root = join(dir, "repo");
    const exps = join(root, "experiments");
    const verdict = (gate: string): string =>
      JSON.stringify({ gate, result: "pass", checks: [], decided_by: "x" });
    const put = (name: string, gate: string, scoring?: object): void => {
      mkdirSync(join(exps, name), { recursive: true });
      writeFileSync(join(exps, name, "verdict.json"), verdict(gate));
      if (scoring) writeFileSync(join(exps, name, "scoring.json"), JSON.stringify(scoring));
    };
    const current = {
      decision: "experiments/d31/decision.json",
      decision_sha256: "a".repeat(64),
      test_seed: "214",
    };
    const scoring = { gate: "G5", ...current, truth_sha256: "b".repeat(64) };
    put("g4-run", "G4");
    put("other-seed", "G5", { ...scoring, test_seed: "213" });

    it("allows a first scoring and ignores other gates and other seeds", () => {
      expect(
        requireScoredOnce(priorG5Scorings(exps), current, join(exps, "new"), undefined, root),
      ).toBeUndefined();
    });

    it("refuses a second scoring of the same decision and seed, by path or by digest", () => {
      put("first", "G5", scoring);
      expect(() =>
        requireScoredOnce(priorG5Scorings(exps), current, join(exps, "new"), undefined, root),
      ).toThrow(/already records G5 .* scored once/);
      expect(() =>
        requireScoredOnce(
          priorG5Scorings(exps),
          { ...current, decision: "elsewhere/decision.json" },
          join(exps, "new"),
          undefined,
          root,
        ),
      ).toThrow(/already records G5/);
    });

    it("allows a reproduction that names the earlier experiment, and only that one", () => {
      expect(
        requireScoredOnce(
          priorG5Scorings(exps),
          current,
          join(exps, "new"),
          join(exps, "first"),
          root,
        ),
      ).toBe("experiments/first");
      expect(() =>
        requireScoredOnce(
          priorG5Scorings(exps),
          current,
          join(exps, "new"),
          join(exps, "other-seed"),
          root,
        ),
      ).toThrow(/no G5 scoring of .* is recorded there/);
      expect(() =>
        requireScoredOnce(
          priorG5Scorings(exps),
          current,
          join(exps, "new"),
          join(exps, "new"),
          root,
        ),
      ).toThrow(/names the output experiment itself/);
    });

    it("refuses beside a G5 verdict with no scoring.json unless it is named", () => {
      put("legacy", "G5");
      expect(() =>
        requireScoredOnce(
          priorG5Scorings(exps),
          { ...current, test_seed: "999" },
          join(exps, "new"),
          undefined,
          root,
        ),
      ).toThrow(/without scoring.json/);
    });
  });
});
