import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RANGES } from "../src/ranges.js";
import { generateScenario } from "../src/scenario.js";

const GOLDEN = new URL("./golden/seed1-3.ndjson", import.meta.url);

describe("golden: sim", () => {
  it("seed 1, scenarios 0–2 are byte-identical to the committed golden file", () => {
    const text = [0, 1, 2]
      .map((i) => JSON.stringify(generateScenario(1n, i, DEFAULT_RANGES).scenario))
      .join("\n")
      .concat("\n");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text);
    expect(existsSync(GOLDEN), "golden file missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN, "utf8")).toBe(true);
  });
});
