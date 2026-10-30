// tma-g5 (spec 012 FR-005): a validation diagnostic end to end, and the test-split bindings.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataset, runCli } from "@tma/data";
import type { PredictionRow } from "@tma/types";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as g5, requireG5Binding } from "../src/cli-g5.js";
import { openPredictionWriter, scenarioSource } from "../src/prediction-file.js";
import { truthRow } from "./helpers.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const configs = new URL("../../../configs/", import.meta.url).pathname;

describe("tma-g5", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-g5-"));
  expect(
    runCli(generate, [
      "--seed",
      "5",
      "--count",
      "400",
      "--ranges",
      join(configs, "phase4-ranges.json"),
      "--heldout-ranges",
      join(configs, "phase4-heldout-ranges.json"),
      "--out",
      dir,
      "--allow-dirty",
    ]),
  ).toBe(0);
  const val = join(dir, "validation.f32pack");
  const test = join(dir, "test.f32pack");
  const write = (truth: string, out: string, estimator: string, k: number): void => {
    const w = openPredictionWriter(out, estimator, "per_timestep", truth);
    for (const s of scenarioSource(truth)) {
      const rows: PredictionRow[] = [];
      for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
        const r = truthRow(s, i);
        rows.push({
          ...r,
          range_m: r.range_m * (1 + 0.05 * k * (1 + (i % 3))),
          course_rad: r.course_rad + 0.02 * k * (1 + (i % 2)),
          speed_mps: r.speed_mps + 0.1 * k * (1 + (i % 2)),
        });
      }
      w.write({
        record: "prediction",
        scenario_index: s.metadata.index,
        estimator,
        mode: "per_timestep",
        rows,
      });
    }
    w.commit();
  };

  it("writes a validation diagnostic and a report; refuses a second scoring", () => {
    write(val, join(dir, "t1.ndjson"), "learned-gain-filter", 0.6);
    write(val, join(dir, "t2.ndjson"), "lstm-gaussian", 1.5);
    write(val, join(dir, "ref.ndjson"), "imm-ref", 1);
    const exp = join(dir, "exp");
    const args = [
      "--truth",
      val,
      "--tracker",
      join(dir, "t1.ndjson"),
      "--tracker",
      join(dir, "t2.ndjson"),
      "--reference",
      join(dir, "ref.ndjson"),
      "--experiment",
      exp,
    ];
    expect(runCli(g5, args)).toBe(0);
    const v = JSON.parse(readFileSync(join(exp, "diagnostic.json"), "utf8")) as {
      gate: string;
      result: string;
      decided_by: string;
    };
    expect(v.gate).toBe("G5");
    expect(v.result).toBe("pass");
    expect(v.decided_by).toMatch(/not a gate decision/);
    expect(existsSync(join(exp, "report.json"))).toBe(true);
    expect(runCli(g5, args)).not.toBe(0);
  });

  it("refuses a test split without the bindings", () => {
    write(test, join(dir, "tt.ndjson"), "lstm-gaussian", 0.5);
    write(test, join(dir, "tr.ndjson"), "imm-ref", 1);
    expect(() =>
      g5([
        "--truth",
        test,
        "--tracker",
        join(dir, "tt.ndjson"),
        "--reference",
        join(dir, "tr.ndjson"),
        "--experiment",
        join(dir, "x"),
      ]),
    ).toThrow(/needs --decision, --plan and --model/);
  });

  describe("test-split bindings", () => {
    const decision = join(dir, "decision.json");
    const model = join(dir, "model");
    mkdirSync(model, { recursive: true });
    writeFileSync(
      join(model, "manifest.json"),
      JSON.stringify({ id: "lstm-gaussian", git_commit: "abc" }),
    );
    const seed = readDataset(test).header.dataset_seed;
    const writeDecision = (over: Record<string, unknown>): void => {
      writeFileSync(
        decision,
        JSON.stringify({
          phase_a_experiment: "x",
          stalled: false,
          change: "x",
          rationale: "x",
          carried_set_rule: "x",
          decided_at: "2026-10-30T00:00:00Z",
          git_commit: "abc",
          plans: ["configs/phase4/b/plan.json"],
          test_seed: seed,
          reference_estimator: "imm-ref",
          carried_models: ["lstm-gaussian"],
          ...over,
        }),
      );
    };
    const binding = {
      decisionPath: decision,
      planPaths: ["configs/phase4/b/plan.json"],
      modelDirs: [model],
      truthPath: test,
      trackers: ["lstm-gaussian"],
      reference: "imm-ref",
    };
    const ok = { isCommitted: () => true, checkDigests: () => undefined, precedes: () => true };

    it("refuses an uncommitted decision and another test seed", () => {
      writeDecision({});
      expect(() => requireG5Binding(binding, { ...ok, isCommitted: () => false })).toThrow(
        /must be committed/,
      );
      writeDecision({ test_seed: "999" });
      expect(() => requireG5Binding(binding, ok)).toThrow(/test seed 999/);
    });

    it("refuses data from a dirty tree (these test data were generated with --allow-dirty)", () => {
      writeDecision({});
      if (readDataset(test).header.generator_git_dirty !== false)
        expect(() => requireG5Binding(binding, ok)).toThrow(/dirty/);
    });
  });
});
