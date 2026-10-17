import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  it("generator 0.3.0 does not accept the iteration-2 G0 (0.2.0): G0 must be re-run (spec 007)", () => {
    // The latest committed G0 (20261013-g0-i2-r2) verified generator 0.2.0. Generator 0.3.0 adds
    // the second zig and the across-LOS rule, so training refuses until a G0 on 0.3.0 passes its
    // panel; this test moves to that experiment when it is committed.
    const dir = new URL("../../../experiments", import.meta.url).pathname;
    const latest = JSON.parse(
      readFileSync(join(dir, "20261013-g0-i2-r2", "manifest.json"), "utf8"),
    ) as { generator_version: string };
    expect(latest.generator_version).toBe("0.2.0");
    expect(g0Accepted(dir, { requireReview: false })).toBeNull();
    expect(g0Accepted(dir)).toBeNull();
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
