// Spec 018: tma-g7's frozen-calibration binding and its refusal of a test split without bindings.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@tma/data";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as g7, requireCalibrations, requireG7Rescore } from "../src/cli-g7.js";
import { openPredictionWriter } from "../src/prediction-file.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const cal = (estimator: string, over: Record<string, number> = {}) =>
  ["log_range", "course", "speed"].map((output) => ({
    estimator,
    output,
    q50: 0.7,
    q90: 1.7,
    ...over,
  }));

describe("tma-g7 (spec 018)", () => {
  it("binds exactly one sound calibration per estimator and output", () => {
    expect(requireCalibrations([...cal("a"), ...cal("b")], ["a", "b"], "d.json")).toHaveLength(6);
    expect(() => requireCalibrations(cal("a"), ["a", "b"], "d.json")).toThrow(
      /0 calibrations for b log_range/,
    );
    expect(() => requireCalibrations([...cal("a"), ...cal("a")], ["a"], "d.json")).toThrow(
      /2 calibrations/,
    );
    expect(() => requireCalibrations(cal("a", { q90: 0.5 }), ["a"], "d.json")).toThrow(/q50 ≤ q90/);
    expect(() => requireCalibrations(cal("a", { q50: 0 }), ["a"], "d.json")).toThrow(/0 < q50/);
  });

  it("refuses a test split without its bindings", () => {
    const dir = mkdtempSync(join(tmpdir(), "tma-g7-"));
    expect(runCli(generate, ["--seed", "3", "--count", "40", "--out", dir, "--allow-dirty"])).toBe(
      0,
    );
    const truth = join(dir, "test.f32pack");
    for (const f of ["t.ndjson", "r.ndjson"])
      openPredictionWriter(join(dir, f), f, "per_timestep", truth).commit();
    expect(() =>
      g7([
        "--truth",
        truth,
        "--tracker",
        join(dir, "t.ndjson"),
        "--reference",
        join(dir, "r.ndjson"),
        "--experiment",
        join(dir, "e"),
      ]),
    ).toThrow(/a test split needs --decision, --plan and --model/);
  });

  it("binds a re-score to an inconclusive G7's frozen multipliers, names and models, on a fresh seed", () => {
    const top = mkdtempSync(join(tmpdir(), "tma-g7-rescore-"));
    const base = {
      phase_a_experiment: "x",
      stalled: false,
      change: "x",
      rationale: "x",
      carried_set_rule: "x",
      decided_at: "2026-11-06T00:00:00Z",
      git_commit: "abc",
      test_seed: "215",
      reference_estimator: "imm-x",
      carried_models: ["fused-x"],
      model_digests: [
        { model: "m", weights_sha256: "a", manifest_sha256: "b", model_json_sha256: "c" },
      ],
      calibrations: [...cal("fused-x"), ...cal("imm-x")],
    };
    mkdirSync(join(top, "d33"));
    writeFileSync(join(top, "d33/decision.json"), JSON.stringify(base));
    mkdirSync(join(top, "g7"));
    const verdict = (result: string): void => {
      writeFileSync(
        join(top, "g7/verdict.json"),
        JSON.stringify({ gate: "G7", result, checks: [], decided_by: "x" }),
      );
    };
    verdict("inconclusive");
    writeFileSync(
      join(top, "g7/scoring.json"),
      JSON.stringify({
        gate: "G7",
        decision: "d33/decision.json",
        decision_sha256: "s",
        test_seed: "215",
        truth_sha256: "t",
      }),
    );
    const rescore = { ...base, test_seed: "216", rescore_of: "g7" };
    const check = (d: typeof rescore) => () => {
      requireG7Rescore(d, "d34.json", top);
    };
    expect(check(rescore)).not.toThrow();
    expect(check({ ...rescore, test_seed: "215" })).toThrow(/fresh test seed/);
    expect(
      check({ ...rescore, calibrations: [...cal("fused-x", { q50: 0.8 }), ...cal("imm-x")] }),
    ).toThrow(/frozen calibrations exactly/);
    expect(check({ ...rescore, carried_models: ["other"] })).toThrow(/tracker, reference/);
    verdict("pass");
    expect(check(rescore)).toThrow(/not an inconclusive G7/);
    verdict("inconclusive");
    writeFileSync(
      join(top, "d33/decision.json"),
      JSON.stringify({ ...base, rescore_of: "earlier" }),
    );
    expect(check(rescore)).toThrow(/itself a re-score/);
  });
});
