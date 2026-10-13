import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { writeFeatures } from "../src/features-file.js";
import { testSource } from "./helpers.js";
import { computeNormalisation } from "../src/normalise.js";

const GOLDEN = new URL("./golden/seed1-2.features.bin", import.meta.url);

describe("golden: features", () => {
  it("seed 1, scenarios 0–1: features binary is byte-identical", () => {
    const ss = [0, 1].map((i) => generateScenario(1n, i, DEFAULT_RANGES).scenario);
    const norm = computeNormalisation(ss, "golden");
    const out = join(mkdtempSync(join(tmpdir(), "tma-feat-")), "f.bin");
    expect(writeFeatures(out, () => ss, norm, testSource())).toBe(2);
    const got = readFileSync(out);
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, got);
    expect(existsSync(GOLDEN), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(got.equals(readFileSync(GOLDEN))).toBe(true);
    // Shape check: header + 2 × (240×10 + 240×6 + 240) float32.
    expect(got.length).toBeGreaterThan(2 * 240 * 17 * 4);
  });
});
