// Generator 0.5.0 (spec 012 T007 prerequisite): 60-min windows need 360 rows. The features file's
// rows come from its source's ranges (`rowsFor`), so phase-3 and older files keep 240.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { outputsToPrediction } from "../src/decode.js";
import { writeFeatures } from "../src/features-file.js";
import { buildWindow, inputWidth, ROWS, rowsFor } from "../src/layout.js";
import { computeNormalisation } from "../src/normalise.js";
import { openFeatures } from "../src/reader.js";
import { testSource } from "./helpers.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;

describe("rows per window", () => {
  it("are 240 up to phase 3 and 360 for 60-min windows", () => {
    expect(rowsFor(DEFAULT_RANGES)).toBe(ROWS);
    expect(rowsFor(PHASE4)).toBe(360);
  });

  it("a phase-4 features file stores and reads 360-row windows", () => {
    const ss = Array.from({ length: 40 }, (_, i) => generateScenario(3n, i, PHASE4).scenario);
    const long = ss.filter((s) => s.metadata.samples > ROWS);
    expect(long.length).toBeGreaterThan(0);
    const norm = computeNormalisation(ss, "rows-test", "derived");
    const path = join(mkdtempSync(join(tmpdir(), "tma-rows-")), "f.bin");
    writeFeatures(
      path,
      () => ss,
      norm,
      testSource({ parameter_ranges: PHASE4, scenario_count: 40 }),
      "derived",
    );
    const f = openFeatures(path);
    expect(f.rows).toBe(360);
    expect(f.layout.rows).toBe(360);
    const s = long[0];
    if (s === undefined) throw new Error("no long scenario");
    const k = ss.indexOf(s);
    const w = f.read(k);
    expect(w.inputs.length).toBe(360 * inputWidth("derived"));
    expect(Array.from(w.inputs)).toEqual(Array.from(buildWindow(s, norm, "derived", 360).inputs));
    f.close();
  });

  it("decoding accepts any row count that covers the scenario", () => {
    const s = generateScenario(3n, 0, PHASE4).scenario;
    const norm = computeNormalisation([s], "rows-test");
    const out = new Float32Array(360 * 4).fill(0.1);
    expect(outputsToPrediction(s, out, norm, "x").rows.length).toBe(
      s.metadata.samples - s.metadata.zig_index - 1,
    );
    expect(() => outputsToPrediction(s, new Float32Array(10 * 4), norm, "x")).toThrow(/covering/);
  });
});
