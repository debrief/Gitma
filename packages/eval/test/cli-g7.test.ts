// Spec 018: tma-g7's frozen-calibration binding and its refusal of a test split without bindings.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@tma/data";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as g7, requireCalibrations } from "../src/cli-g7.js";
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
});
