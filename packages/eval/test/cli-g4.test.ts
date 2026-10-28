// Spec 010: tma-g4 end to end on a tiny phase-3 dataset, and its test-split bindings (FR-009).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataset, runCli } from "@tma/data";
import type { PredictionRow } from "@tma/types";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as g4, requireG4Binding } from "../src/cli-g4.js";
import { openPredictionWriter, scenarioSource } from "../src/prediction-file.js";
import { truthRow } from "./helpers.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const configs = new URL("../../../configs/", import.meta.url).pathname;

describe("tma-g4", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-g4-"));
  expect(
    runCli(generate, [
      "--seed",
      "5",
      "--count",
      "600",
      "--ranges",
      join(configs, "phase3-ranges.json"),
      "--heldout-ranges",
      join(configs, "phase3-heldout-ranges.json"),
      "--out",
      dir,
      "--allow-dirty",
    ]),
  ).toBe(0);
  const val = join(dir, "validation.f32pack");
  const test = join(dir, "test.f32pack");
  /** Per-timestep predictions echoing the truth with range scaled by k. */
  const write = (truth: string, out: string, estimator: string, k: number, dc = 0.02): void => {
    const w = openPredictionWriter(out, estimator, "per_timestep", truth);
    for (const s of scenarioSource(truth)) {
      const rows: PredictionRow[] = [];
      for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
        const r = truthRow(s, i);
        rows.push({
          ...r,
          range_m: r.range_m * (k + (i % 3) * 0.01),
          course_rad: r.course_rad + dc * k * (1 + (i % 2)),
          speed_mps: r.speed_mps + 0.1 * k,
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
  for (const [split, truth] of [
    ["validation", val],
    ["test", test],
  ] as const) {
    write(truth, join(dir, `${split}.net.ndjson`), "lstm-instantaneous", 1.05);
    write(truth, join(dir, `${split}.ref.ndjson`), "imm-cv0-ct0.03-w0.003-s0.0001", 1.2);
    write(truth, join(dir, `${split}.lsq.ndjson`), "classical", 1.3);
  }

  it("judges a validation split as a diagnostic and reports every estimator on the same rows", () => {
    const exp = join(dir, "exp-val");
    const out = g4([
      "--truth",
      val,
      "--network",
      join(dir, "validation.net.ndjson"),
      "--reference",
      join(dir, "validation.ref.ndjson"),
      "--also",
      join(dir, "validation.lsq.ndjson"),
      "--experiment",
      exp,
    ]) as { result: string };
    expect(out.result).toBe("pass");
    const d = JSON.parse(readFileSync(join(exp, "diagnostic.json"), "utf8")) as {
      decided_by: string;
    };
    expect(d.decided_by).toMatch(/diagnostic/);
    expect(existsSync(join(exp, "verdict.json"))).toBe(false);
    const report = JSON.parse(readFileSync(join(exp, "report.json"), "utf8")) as {
      estimator: string;
    }[];
    expect(new Set(report.map((r) => r.estimator)).size).toBe(3);
    expect(() =>
      g4([
        "--truth",
        val,
        "--network",
        join(dir, "validation.net.ndjson"),
        "--reference",
        join(dir, "validation.ref.ndjson"),
        "--experiment",
        exp,
      ]),
    ).toThrow(/scored once/);
  });

  it("refuses a test split without the decision, plan and model", () => {
    expect(() =>
      g4([
        "--truth",
        test,
        "--network",
        join(dir, "test.net.ndjson"),
        "--reference",
        join(dir, "test.ref.ndjson"),
        "--experiment",
        join(dir, "exp-test"),
      ]),
    ).toThrow(/needs --decision, --plan and --model/);
  });

  describe("test-split bindings", () => {
    const decision = join(dir, "decision.json");
    const model = join(dir, "model");
    mkdirSync(model, { recursive: true });
    writeFileSync(
      join(model, "manifest.json"),
      JSON.stringify({ id: "lstm-instantaneous", git_commit: "abc" }),
    );
    const seed = readDataset(test).header.dataset_seed;
    const write = (over: Record<string, unknown>): void => {
      writeFileSync(
        decision,
        JSON.stringify({
          phase_a_experiment: "x",
          stalled: false,
          change: "x",
          rationale: "x",
          carried_set_rule: "x",
          decided_at: "2026-10-28T00:00:00Z",
          git_commit: "abc",
          plan: "configs/phase3/a/plan.json",
          test_seed: seed,
          reference_estimator: "imm-cv0-ct0.03-w0.003-s0.0001",
          carried_model: "lstm-instantaneous",
          ...over,
        }),
      );
    };
    const binding = {
      decisionPath: decision,
      planPath: "configs/phase3/a/plan.json",
      modelDir: model,
      truthPath: test,
      network: "lstm-instantaneous",
      reference: "imm-cv0-ct0.03-w0.003-s0.0001",
    };
    const ok = { isCommitted: () => true, checkDigests: () => undefined, precedes: () => true };

    it("refuses an uncommitted decision", () => {
      write({});
      expect(() => requireG4Binding(binding, { ...ok, isCommitted: () => false })).toThrow(
        /must be committed/,
      );
    });
    it("refuses another test seed", () => {
      write({ test_seed: "999" });
      expect(() => requireG4Binding(binding, ok)).toThrow(/test seed 999/);
    });
    it("refuses data from a dirty tree (the test data here were generated with --allow-dirty)", () => {
      write({});
      if (readDataset(test).header.generator_git_dirty !== false)
        expect(() => requireG4Binding(binding, ok)).toThrow(/dirty/);
    });
    it("refuses another reference, another carried model, or a model trained before the decision", () => {
      const clean = { ...binding };
      const deps = ok;
      // Skip the provenance refusal so the later bindings are reached.
      const h = readDataset(test).header;
      if (h.generator_git_dirty !== false) return;
      write({ reference_estimator: "ekf-sa0.03" });
      expect(() => requireG4Binding(clean, deps)).toThrow(/freezes reference ekf-sa0.03/);
      write({ carried_model: "other" });
      expect(() => requireG4Binding(clean, deps)).toThrow(/carries other/);
      write({});
      expect(() => requireG4Binding(clean, { ...deps, precedes: () => false })).toThrow(
        /not committed before/,
      );
      expect(requireG4Binding(clean, deps).carried_model).toBe("lstm-instantaneous");
    });
  });
});
