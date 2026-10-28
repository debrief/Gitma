// Spec 010: tma-track writes per-timestep tracker predictions, named by their settings.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@tma/data";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as track } from "../src/cli-track.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

describe("tma-track", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-track-"));
  expect(runCli(generate, ["--seed", "4", "--count", "40", "--out", dir, "--allow-dirty"])).toBe(0);
  const truth = join(dir, "test.f32pack");

  it("writes IMM rows from zig_index + 1, named by every setting, scales included", () => {
    const out = join(dir, "imm.ndjson");
    const r = track([
      "--in",
      truth,
      "--out",
      out,
      "--filter",
      "imm",
      "--sigma-cv",
      "0",
      "--sigma-ct",
      "0.03",
      "--sigma-omega",
      "0.003",
      "--switch",
      "0.0001",
      "--r-scale",
      "4",
    ]) as { estimator: string; scenarios: number };
    expect(r.estimator).toBe("imm-cv0-ct0.03-w0.003-s0.0001-r4");
    expect(r.scenarios).toBe(4);
    const lines = readFileSync(out, "utf8").trim().split("\n");
    const header = JSON.parse(lines[0] ?? "") as { estimator: string; mode: string };
    expect(header).toMatchObject({ estimator: r.estimator, mode: "per_timestep" });
    expect(lines).toHaveLength(5);
  });

  it("an EKF without scales keeps its plain name, and bad settings are refused", () => {
    const r = track([
      "--in",
      truth,
      "--out",
      join(dir, "ekf.ndjson"),
      "--filter",
      "ekf",
      "--sigma-a",
      "0.03",
    ]) as { estimator: string };
    expect(r.estimator).toBe("ekf-sa0.03");
    expect(() =>
      track(["--in", truth, "--out", join(dir, "x.ndjson"), "--filter", "ekf", "--sigma-a=-1"]),
    ).toThrow(/≥ 0/);
    expect(() =>
      track([
        "--in",
        truth,
        "--out",
        join(dir, "x.ndjson"),
        "--filter",
        "ekf",
        "--sigma-a",
        "0",
        "--p0-scale",
        "0",
      ]),
    ).toThrow(/> 0/);
    expect(() => track(["--in", truth, "--out", join(dir, "x.ndjson"), "--filter", "ukf"])).toThrow(
      /ekf or imm/,
    );
  });
});
