// Spec 009: tma-hybrid and tma-g3 end to end on a tiny dataset.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataset, runCli } from "@tma/data";
import { describe, expect, it, vi } from "vitest";
import { main as solve } from "../../classical/src/cli-solve.js";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as g3, requireG3Decision } from "../src/cli-g3.js";
import { main as hybrid } from "../src/cli-hybrid.js";
import { openPredictionWriter, scenarioSource } from "../src/prediction-file.js";
import { truthRow } from "./helpers.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

describe("tma-hybrid and tma-g3", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-g3-"));
  expect(runCli(generate, ["--seed", "3", "--count", "400", "--out", dir, "--allow-dirty"])).toBe(
    0,
  );
  const val = join(dir, "validation.f32pack");
  const test = join(dir, "test.f32pack");
  /** A "network" that echoes the truth with a 10% range error, per timestep. */
  const network = (truth: string, out: string): void => {
    const w = openPredictionWriter(out, "lstm-instantaneous", "per_timestep", truth);
    for (const s of scenarioSource(truth)) {
      const rows = [];
      for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
        const r = truthRow(s, i);
        rows.push({ ...r, range_m: r.range_m * 1.1 });
      }
      w.write({
        record: "prediction",
        scenario_index: s.metadata.index,
        estimator: "lstm-instantaneous",
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
    expect(
      runCli(solve, [
        "--in",
        truth,
        "--out",
        join(dir, `${split}.classical.ndjson`),
        "--per-timestep",
      ]),
    ).toBe(0);
    network(truth, join(dir, `${split}.lstm.ndjson`));
  }

  it("writes the hybrid, and judges a non-test split as a diagnostic", () => {
    const out = hybrid([
      "--truth",
      val,
      "--classical",
      join(dir, "validation.classical.ndjson"),
      "--network",
      join(dir, "validation.lstm.ndjson"),
      "--out",
      join(dir, "validation.hybrid.ndjson"),
    ]) as { estimator: string; scenarios: number };
    expect(out.estimator).toBe("hybrid-lstm-instantaneous");
    expect(out.scenarios).toBeGreaterThan(0);
    const exp = join(dir, "val-exp");
    const args = [
      "--truth",
      val,
      "--hybrid",
      join(dir, "validation.hybrid.ndjson"),
      "--classical",
      join(dir, "validation.classical.ndjson"),
      "--experiment",
      exp,
    ];
    g3(args);
    const d = JSON.parse(readFileSync(join(exp, "diagnostic.json"), "utf8")) as {
      gate: string;
      decided_by: string;
      checks: unknown[];
    };
    expect(d.gate).toBe("G3");
    expect(d.decided_by).toMatch(/validation diagnostic/);
    expect(d.checks).toHaveLength(7);
    expect(existsSync(join(exp, "verdict.json"))).toBe(false);
    // Scored once.
    expect(() => g3(args)).toThrow(/scored once/);
  });

  it("refuses inputs in the wrong roles", () => {
    expect(() =>
      hybrid([
        "--truth",
        val,
        "--classical",
        join(dir, "validation.lstm.ndjson"),
        "--network",
        join(dir, "validation.lstm.ndjson"),
        "--out",
        join(dir, "x.ndjson"),
      ]),
    ).toThrow(/not classical/);
  });

  it("a test split needs a committed decision naming its seed, from clean data", () => {
    const base = [
      "--truth",
      test,
      "--hybrid",
      join(dir, "validation.hybrid.ndjson"),
      "--classical",
      join(dir, "test.classical.ndjson"),
      "--experiment",
      join(dir, "test-exp"),
    ];
    expect(() => g3(base)).toThrow(/needs --decision/);
    const decision = join(dir, "decision.json");
    const record = {
      carried_set_rule: "r",
      change: "c",
      decided_at: "2026-10-27T00:00:00Z",
      git_commit: "0".repeat(40),
      phase_a_experiment: "p",
      rationale: "r",
      stalled: false,
      test_seed: "3",
    };
    writeFileSync(decision, JSON.stringify(record));
    expect(() => requireG3Decision(decision, test, () => false)).toThrow(/must be committed/);
    writeFileSync(decision, JSON.stringify({ ...record, test_seed: "4" }));
    expect(() => requireG3Decision(decision, test, () => true)).toThrow(/test seed 4/);
    // With the right seed it is accepted, unless the test data came from a dirty tree (as they
    // do locally with uncommitted changes; CI's checkout is clean).
    writeFileSync(decision, JSON.stringify(record));
    if (readDataset(test).header.generator_git_dirty === false)
      expect(requireG3Decision(decision, test, () => true).test_seed).toBe("3");
    else expect(() => requireG3Decision(decision, test, () => true)).toThrow(/dirty tree/);
  });
});
