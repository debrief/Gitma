// Spec 019 (G0 panel phase 7, red team): generator 0.6.0's bearing error survives the .f32pack
// writer and reader. G0's `bearing-error-model` regenerates in memory, and G0's own data are noise-free.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { generateDataset, readDataset } from "../src/index.js";
import { tempDir } from "./helpers.js";

const read = (f: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../configs/${f}`, import.meta.url), "utf8"),
  ) as ParameterRanges;

describe("bearing error through .f32pack (generator 0.6.0)", () => {
  it("stored bearings, and the recorded model, are the generator's", () => {
    const ranges = read("phase7-ranges.json");
    const out = tempDir();
    generateDataset({
      seed: 11n,
      count: 20,
      outDir: out,
      ranges,
      heldoutRanges: read("phase7-heldout-ranges.json"),
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "c".repeat(40), generator_git_dirty: false },
    });
    const ds = readDataset(join(out, "train.f32pack"));
    expect(ds.header.parameter_ranges.bearing_error).toEqual(ranges.bearing_error);
    let n = 0;
    for (const s of ds.scenarios()) {
      const g = generateScenario(11n, s.metadata.index, ranges).scenario;
      expect(s.metadata.parameters.bearing_error).not.toBeUndefined();
      expect(s.observations).toEqual(g.observations);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });
});
