import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@tma/data";
import { main as generate } from "../../data/src/cli-generate.js";
import { describe, expect, it, vi } from "vitest";
import { main as solve } from "../src/cli-solve.js";
import { fileDigest, parsePredictions } from "../src/predictions.js";

describe("tma-solve", () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  it("writes a validated prediction file bound to the truth file's digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "tma-solve-"));
    expect(runCli(generate, ["--seed", "3", "--count", "30", "--out", dir])).toBe(0);
    const truth = join(dir, "test.f32pack");
    const out = join(dir, "pred.ndjson");
    expect(runCli(solve, ["--in", truth, "--out", out])).toBe(0);
    const { header, predictions } = parsePredictions(out, readFileSync(out, "utf8"));
    expect(header.dataset_digest).toBe(fileDigest(truth));
    expect(header.mode).toBe("final");
    expect(predictions).toHaveLength(3);
    expect(runCli(solve, ["--in", truth])).toBe(1);
  });
});
