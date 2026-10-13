import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_VERSION } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { g0Accepted, g0Passed } from "../src/g0-guard.js";
import { tempDir } from "./helpers.js";

interface Exp {
  gate?: string;
  result?: string;
  created: string;
  generator?: string;
  dirty?: boolean;
  commit?: string;
}

function experiment(
  dir: string,
  id: string,
  e: Exp & { decidedBy?: string; review?: boolean },
): void {
  mkdirSync(join(dir, id));
  writeFileSync(
    join(dir, id, "verdict.json"),
    JSON.stringify({
      gate: e.gate ?? "G0",
      result: e.result ?? "pass",
      checks: [],
      decided_by: e.decidedBy ?? "t",
    }),
  );
  if (e.review === true) writeFileSync(join(dir, id, "review.md"), "# review\n");
  writeFileSync(
    join(dir, id, "manifest.json"),
    JSON.stringify({
      id,
      created: e.created,
      git_commit: e.commit ?? "verified",
      git_dirty: e.dirty ?? false,
      schema_version: "0.4.0",
      generator_version: e.generator ?? GENERATOR_VERSION,
      datasets: [],
      estimators: [],
      command_lines: [],
    }),
  );
}

const T1 = "2026-10-11T01:00:00Z";
const T2 = "2026-10-11T02:00:00Z";
const guard = (dir: string) => g0Passed(dir, { generatorUnchanged: (c) => c === "verified" });

describe("G0 guard (constitution V)", () => {
  it("refuses without a passing G0 and allows with one", () => {
    const dir = tempDir();
    expect(guard(join(dir, "missing"))).toBeNull();
    experiment(dir, "a", { result: "fail", created: T1 });
    expect(guard(dir)).toBeNull();
    experiment(dir, "b", { created: T2 });
    expect(guard(dir)).toBe("b");
  });

  it("the latest by created time decides, whatever the folder names", () => {
    const dir = tempDir();
    experiment(dir, "z-pass", { created: T1 });
    experiment(dir, "a-fail", { result: "fail", created: T2 });
    expect(guard(dir)).toBeNull();
  });

  it("later gates do not hide the latest G0", () => {
    const dir = tempDir();
    experiment(dir, "a", { created: T1 });
    experiment(dir, "b", { gate: "G1", result: "fail", created: T2 });
    expect(guard(dir)).toBe("a");
  });

  it("refuses ties, dirty runs, other generator versions and changed generator source", () => {
    const tie = tempDir();
    experiment(tie, "a", { created: T1 });
    experiment(tie, "b", { created: T1 });
    expect(guard(tie)).toBeNull();
    for (const e of [{ dirty: true }, { generator: "0.0.0-other" }, { commit: "elsewhere" }]) {
      const dir = tempDir();
      experiment(dir, "a", { created: T1, ...e });
      expect(guard(dir)).toBeNull();
    }
  });

  it("refuses when any G0 manifest has an unparseable created time", () => {
    const dir = tempDir();
    experiment(dir, "a", { created: T1 });
    experiment(dir, "b", { created: "not a date" });
    expect(guard(dir)).toBeNull();
  });

  it("refuses a G0 verdict without a manifest", () => {
    const dir = tempDir();
    experiment(dir, "a", { created: T1 });
    mkdirSync(join(dir, "b"));
    writeFileSync(
      join(dir, "b", "verdict.json"),
      JSON.stringify({ gate: "G0", result: "pass", checks: [], decided_by: "t" }),
    );
    expect(guard(dir)).toBeNull();
  });

  it("with requireReview, accepts only a panel-decided G0 with its review.md", () => {
    const opts = { generatorUnchanged: (c: string) => c === "verified", requireReview: true };
    const dir = tempDir();
    experiment(dir, "harness", { created: T1, decidedBy: "harness (pending agent panel review)" });
    expect(g0Accepted(dir, opts)).toBeNull();
    experiment(dir, "no-review", { created: T2, decidedBy: "agent review panel, round 1" });
    expect(g0Accepted(dir, opts)).toBeNull();
    writeFileSync(join(dir, "no-review", "review.md"), "# review\n");
    expect(g0Accepted(dir, opts)).toEqual({ id: "no-review", commit: "verified" });
    // Without requireReview the machine verdict alone is enough (library default).
    const lib = tempDir();
    experiment(lib, "h", { created: T1, decidedBy: "harness (pending agent panel review)" });
    expect(g0Accepted(lib, { generatorUnchanged: (c) => c === "verified" })).not.toBeNull();
  });

  it("the committed iteration-2 G0 re-run is the latest, and needs its panel review", () => {
    // Round-1 fixes (24bbdab) touched packages/data/src, so G0 was re-run there (T019-T020).
    const dir = new URL("../../../experiments", import.meta.url).pathname;
    const want = { id: "20261013-g0-i2-r2", commit: "24bbdab5d79f3c872f88ac6494c2d73068016225" };
    expect(g0Accepted(dir)).toEqual(want);
    const verdict = JSON.parse(readFileSync(join(dir, want.id, "verdict.json"), "utf8")) as {
      decided_by: string;
    };
    const reviewed =
      existsSync(join(dir, want.id, "review.md")) &&
      verdict.decided_by.startsWith("agent review panel");
    expect(g0Accepted(dir, { requireReview: true })).toEqual(reviewed ? want : null);
  });

  it("returns the accepted experiment's id and commit", () => {
    const dir = tempDir();
    experiment(dir, "a", { created: T1 });
    expect(g0Accepted(dir, { generatorUnchanged: (c) => c === "verified" })).toEqual({
      id: "a",
      commit: "verified",
    });
  });
});
