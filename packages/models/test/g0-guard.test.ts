import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_VERSION } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { g0Passed } from "../src/g0-guard.js";
import { tempDir } from "./helpers.js";

function experiment(
  dir: string,
  id: string,
  gate: string,
  result: string,
  generator = GENERATOR_VERSION,
) {
  mkdirSync(join(dir, id));
  writeFileSync(
    join(dir, id, "verdict.json"),
    JSON.stringify({ gate, result, checks: [], decided_by: "test" }),
  );
  writeFileSync(
    join(dir, id, "manifest.json"),
    JSON.stringify({
      id,
      created: "2026-10-11T00:00:00Z",
      git_commit: "x",
      schema_version: "0.4.0",
      generator_version: generator,
      datasets: [],
      estimators: [],
      command_lines: [],
    }),
  );
}

describe("G0 guard (constitution V)", () => {
  it("refuses without a passing G0 and allows with one", () => {
    const dir = tempDir();
    expect(g0Passed(join(dir, "missing"))).toBeNull();
    experiment(dir, "a", "G0", "fail");
    expect(g0Passed(dir)).toBeNull();
    experiment(dir, "b", "G0", "pass");
    expect(g0Passed(dir)).toBe("b");
  });

  it("a newer G0 failure blocks training despite an older pass", () => {
    const dir = tempDir();
    experiment(dir, "a", "G0", "pass");
    experiment(dir, "b", "G0", "fail");
    expect(g0Passed(dir)).toBeNull();
  });

  it("later gates do not hide the latest G0", () => {
    const dir = tempDir();
    experiment(dir, "a", "G0", "pass");
    experiment(dir, "b", "G1", "fail");
    expect(g0Passed(dir)).toBe("a");
  });

  it("refuses a G0 pass judged on a different generator version", () => {
    const dir = tempDir();
    experiment(dir, "a", "G0", "pass", "0.0.0-other");
    expect(g0Passed(dir)).toBeNull();
  });

  it("accepts the committed G0 experiments", () => {
    expect(g0Passed(new URL("../../../experiments", import.meta.url).pathname)).toMatch(/-g0/);
  });
});
