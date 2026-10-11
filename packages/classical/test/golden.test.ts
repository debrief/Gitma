import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "@tma/data";
import { DEFAULT_RANGES } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { classicalPredict } from "../src/estimate.js";
import { scenarios } from "./helpers.js";

const GOLDEN = new URL("./golden/seed1-classical.ndjson", import.meta.url);

describe("golden: classical", () => {
  it("seed 1, scenarios 0–1, final and per-timestep, byte-identical", () => {
    const lines = scenarios(1n, 2, DEFAULT_RANGES).flatMap((s) => [
      canonicalJson(classicalPredict(s, "final")),
      canonicalJson(classicalPredict(s, "per_timestep")),
    ]);
    const text = `${lines.join("\n")}\n`;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text);
    expect(existsSync(GOLDEN), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN, "utf8")).toBe(true);
  });
});
