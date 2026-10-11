import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { g0Passed } from "../src/g0-guard.js";
import { tempDir } from "./helpers.js";

const verdict = (gate: string, result: string) =>
  JSON.stringify({ gate, result, checks: [], decided_by: "test" });

describe("G0 guard (constitution V)", () => {
  it("refuses without a passing G0 and allows with one", () => {
    const dir = tempDir();
    expect(g0Passed(join(dir, "missing"))).toBeNull();
    mkdirSync(join(dir, "a"));
    writeFileSync(join(dir, "a", "verdict.json"), verdict("G0", "fail"));
    expect(g0Passed(dir)).toBeNull();
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "b", "verdict.json"), verdict("G0", "pass"));
    expect(g0Passed(dir)).toBe("b");
  });

  it("accepts the committed G0 experiment", () => {
    expect(g0Passed(new URL("../../../experiments", import.meta.url).pathname)).toBe("20261011-g0");
  });
});
