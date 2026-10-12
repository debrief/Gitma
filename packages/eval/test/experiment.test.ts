import { describe, expect, it, vi } from "vitest";

// Count every git invocation so the test can show the manifest reads no git state at write time.
const calls = vi.hoisted(() => ({ git: [] as string[][] }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: (...a: Parameters<typeof actual.execFileSync>) => {
      if (a[0] === "git") calls.git.push([...(a[1] ?? [])]);
      return actual.execFileSync(...a);
    },
  };
});

const { gitCommit, gitDirty, makeManifest } = await import("../src/experiment.js");

describe("experiment manifest provenance", () => {
  it("captures git_commit and git_dirty together at process start, not at write time", () => {
    const atStart = calls.git.map((c) => c[0]);
    expect(atStart).toEqual(["rev-parse", "status"]);
    const m = makeManifest("x", [], [], ["cmd"]);
    expect(calls.git).toHaveLength(2);
    expect(m.git_commit).toBe(gitCommit());
    expect(m.git_dirty).toBe(gitDirty());
    expect(m.git_commit).toMatch(/^([0-9a-f]{40}|unknown)$/);
  });
});
