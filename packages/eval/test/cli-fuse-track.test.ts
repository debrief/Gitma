// tma-fuse-track (spec 014): the fused tracker as a pipeline stage, with its input's digest.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@tma/data";
import type { PredictionRow } from "@tma/types";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as fuse } from "../src/cli-fuse-track.js";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "../src/prediction-file.js";
import { truthRow } from "./helpers.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const configs = new URL("../../../configs/", import.meta.url).pathname;

describe("tma-fuse-track", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-fuse-"));
  expect(
    runCli(generate, [
      "--seed",
      "6",
      "--count",
      "100",
      "--ranges",
      join(configs, "phase4-ranges.json"),
      "--heldout-ranges",
      join(configs, "phase4-heldout-ranges.json"),
      "--out",
      dir,
      "--allow-dirty",
    ]),
  ).toBe(0);
  const truth = join(dir, "validation.f32pack");
  const net = join(dir, "net.ndjson");
  const w = openPredictionWriter(net, "lstm-gaussian", "per_timestep", truth, {
    model_weights_sha256: "ab".repeat(32),
  });
  for (const s of scenarioSource(truth)) {
    const rows: PredictionRow[] = [];
    for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++)
      rows.push({ ...truthRow(s, i), log_range_sd: 0.1 });
    w.write({
      record: "prediction",
      scenario_index: s.metadata.index,
      estimator: "lstm-gaussian",
      mode: "per_timestep",
      rows,
    });
  }
  w.commit();
  const imm = [
    "--sigma-cv",
    "0.01",
    "--sigma-ct",
    "0.03",
    "--sigma-omega",
    "0.01",
    "--switch",
    "0.001",
  ];

  it("writes the fused predictions, named with its settings, recording its input's digest", () => {
    const out = join(dir, "fused.ndjson");
    expect(
      runCli(fuse, [
        "--truth",
        truth,
        "--network",
        net,
        "--out",
        out,
        ...imm,
        "--p0-scale",
        "4",
        "--r-scale",
        "8",
      ]),
    ).toBe(0);
    const p = openPredictionSet(out, truth);
    expect(p.estimator).toBe("fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-k4-m6");
    expect(p.header?.inputs).toEqual([
      {
        estimator: "lstm-gaussian",
        sha256: createHash("sha256").update(readFileSync(net)).digest("hex"),
      },
    ]);
    const n = [...scenarioSource(truth)].length;
    expect(p.byIndex.size).toBe(n);
  });

  it("refuses missing options and bad fusion settings", () => {
    const out = join(dir, "bad.ndjson");
    expect(runCli(fuse, ["--truth", truth, "--network", net, "--out", out])).not.toBe(0);
    expect(
      runCli(fuse, ["--truth", truth, "--network", net, "--out", out, ...imm, "--k", "0"]),
    ).not.toBe(0);
    expect(
      runCli(fuse, ["--truth", truth, "--network", net, "--out", out, ...imm, "--every", "2.5"]),
    ).not.toBe(0);
  });
});
