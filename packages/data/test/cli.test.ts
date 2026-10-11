import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { main as convert } from "../src/cli-convert.js";
import { main as generate } from "../src/cli-generate.js";
import { tempDir } from "./helpers.js";

describe("CLI exit codes (contracts/cli.md)", () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  it("usage errors exit 1", () => {
    expect(runCli(generate, ["--seed", "1"])).toBe(1);
    expect(runCli(generate, ["--bogus"])).toBe(1);
  });

  it("generate then check exits 0; differing datasets exit 2", () => {
    const dir = tempDir();
    expect(runCli(generate, ["--seed", "1", "--count", "20", "--out", dir, "--format", "both"])).toBe(0);
    expect(runCli(convert, ["--check", join(dir, "test.ndjson"), join(dir, "test.f32pack")])).toBe(0);
    expect(runCli(convert, ["--check", join(dir, "test.ndjson"), join(dir, "train.f32pack")])).toBe(2);
  });
});
