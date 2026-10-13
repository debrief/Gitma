// Dataset header provenance (spec 003 US1, T006): clean tree → commit and dirty: false; dirty
// tree → refused unless --allow-dirty; outside git → refused unless --allow-dirty.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main as generate } from "../src/cli-generate.js";
import { runCli } from "../src/cli.js";
import { readDataset } from "../src/dataset.js";
import {
  generatorProvenance,
  type GitProvenance,
  ProvenanceError,
  readGitProvenance,
} from "../src/provenance.js";
import { tempDir } from "./helpers.js";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();

function cleanRepo(): string {
  const dir = tempDir();
  git(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

describe("git provenance", () => {
  it("clean tree: the commit and dirty: false", () => {
    const dir = cleanRepo();
    const p = readGitProvenance(dir);
    expect(p).toEqual({ commit: git(dir, "rev-parse", "HEAD"), dirty: false, inGit: true });
    expect(p.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(generatorProvenance(p, false)).toEqual({
      generator_git_commit: p.commit,
      generator_git_dirty: false,
    });
  });

  it("dirty tree (modified or untracked): refused without --allow-dirty, dirty: true with it", () => {
    const dir = cleanRepo();
    writeFileSync(join(dir, "new.txt"), "x\n");
    const untracked = readGitProvenance(dir);
    expect(untracked.dirty).toBe(true);
    expect(() => generatorProvenance(untracked, false)).toThrow(ProvenanceError);
    expect(generatorProvenance(untracked, true)).toEqual({
      generator_git_commit: untracked.commit,
      generator_git_dirty: true,
    });
    const dir2 = cleanRepo();
    writeFileSync(join(dir2, "a.txt"), "changed\n");
    expect(readGitProvenance(dir2).dirty).toBe(true);
  });

  it("outside git: refused without --allow-dirty; with it, commit unknown and dirty", () => {
    const dir = tempDir();
    expect(existsSync(join(dir, ".git"))).toBe(false);
    const p = readGitProvenance(dir);
    expect(p).toEqual({ commit: "unknown", dirty: true, inGit: false });
    expect(() => generatorProvenance(p, false)).toThrow(/not in a git checkout/);
    expect(generatorProvenance(p, true)).toEqual({
      generator_git_commit: "unknown",
      generator_git_dirty: true,
    });
  });
});

describe("tma-generate header provenance", () => {
  const CLEAN: GitProvenance = { commit: "a".repeat(40), dirty: false, inGit: true };
  const DIRTY: GitProvenance = { ...CLEAN, dirty: true };
  const OUTSIDE: GitProvenance = { commit: "unknown", dirty: true, inGit: false };
  const run = (p: GitProvenance, extra: string[] = []): { code: number; dir: string } => {
    const dir = tempDir();
    const code = runCli(
      (a) => generate(a, { provenance: () => p }),
      ["--seed", "1", "--count", "10", "--out", dir, ...extra],
    );
    return { code, dir };
  };

  it("records the commit and dirty: false from a clean tree", () => {
    const { code, dir } = run(CLEAN);
    expect(code).toBe(0);
    const h = readDataset(join(dir, "test.f32pack")).header;
    expect(h.generator_git_commit).toBe(CLEAN.commit);
    expect(h.generator_git_dirty).toBe(false);
  });

  it("refuses a dirty tree (exit 2, nothing written) unless --allow-dirty", () => {
    const refused = run(DIRTY);
    expect(refused.code).toBe(2);
    expect(existsSync(join(refused.dir, "train.f32pack"))).toBe(false);
    const allowed = run(DIRTY, ["--allow-dirty"]);
    expect(allowed.code).toBe(0);
    expect(readDataset(join(allowed.dir, "train.f32pack")).header.generator_git_dirty).toBe(true);
  });

  it("refuses outside git unless --allow-dirty", () => {
    expect(run(OUTSIDE).code).toBe(2);
    const allowed = run(OUTSIDE, ["--allow-dirty"]);
    expect(allowed.code).toBe(0);
    const h = readDataset(join(allowed.dir, "train.f32pack")).header;
    expect(h.generator_git_commit).toBe("unknown");
    expect(h.generator_git_dirty).toBe(true);
  });

  it("reads the real checkout by default (this repository)", () => {
    const p = readGitProvenance();
    expect(p.inGit).toBe(true);
    expect(p.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
