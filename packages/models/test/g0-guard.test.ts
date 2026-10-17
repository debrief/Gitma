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
      decided_by: e.decidedBy ?? "agent review panel, round 1 (no rejections; fixture)",
    }),
  );
  if (e.review !== false) writeFileSync(join(dir, id, "review.md"), "# review\n");
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

  it("by default accepts only a panel-decided G0 with its review.md", () => {
    const opts = { generatorUnchanged: (c: string) => c === "verified" };
    const dir = tempDir();
    experiment(dir, "harness", {
      created: T1,
      decidedBy: "harness (pending agent panel review)",
      review: false,
    });
    expect(g0Accepted(dir, opts)).toBeNull();
    experiment(dir, "pending", {
      created: T2,
      decidedBy: "agent review panel (pending)",
      review: true,
    });
    expect(g0Accepted(dir, opts)).toBeNull();
    const T3 = "2026-10-11T03:00:00Z";
    experiment(dir, "no-review", {
      created: T3,
      decidedBy: "agent review panel, round 2 (no rejections; no open blocker or major findings)",
      review: false,
    });
    expect(g0Accepted(dir, opts)).toBeNull();
    writeFileSync(join(dir, "no-review", "review.md"), "# review\n");
    expect(g0Accepted(dir, opts)).toEqual({ id: "no-review", commit: "verified" });
    // requireReview: false (tma-train --allow-unreviewed-g0) accepts the machine verdict alone.
    const lib = tempDir();
    experiment(lib, "h", { created: T1, decidedBy: "harness (pending agent panel review)" });
    expect(
      g0Accepted(lib, { generatorUnchanged: (c) => c === "verified", requireReview: false }),
    ).not.toBeNull();
  });

  it("the committed iteration-3 G0 (generator 0.3.0) is the latest, and needs its panel review", () => {
    // Generator 0.3.0 (spec 007) no longer accepts the iteration-2 G0 (20261013-g0-i2-r2, 0.2.0).
    // G0 ran on 0.3.0 at c804757 and, after the round-1 panel fixes to its checks, again at
    // 5989b3e (round 2); the generator source HEAD still matches.
    const dir = new URL("../../../experiments", import.meta.url).pathname;
    const want = { id: "20261017-g0-i3-r2", commit: "5989b3edfdf080e8867e5b6987570597837c2acd" };
    expect(g0Accepted(dir, { requireReview: false })).toEqual(want);
    const verdict = JSON.parse(readFileSync(join(dir, want.id, "verdict.json"), "utf8")) as {
      decided_by: string;
    };
    const reviewed =
      existsSync(join(dir, want.id, "review.md")) &&
      /^agent review panel, rounds? \d+(-\d+)? \(no rejections/.test(verdict.decided_by);
    expect(g0Accepted(dir)).toEqual(reviewed ? want : null);
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
