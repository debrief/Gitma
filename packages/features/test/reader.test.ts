import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RANGES, generateScenario } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { writeFeatures } from "../src/features-file.js";
import { testSource } from "./helpers.js";
import { buildWindow } from "../src/layout.js";
import { computeNormalisation } from "../src/normalise.js";
import { openFeatures } from "../src/reader.js";

describe("features reader", () => {
  const ss = [0, 1, 2, 3].map((i) => generateScenario(5n, i, DEFAULT_RANGES).scenario);
  const norm = computeNormalisation(ss, "d");
  const path = join(mkdtempSync(join(tmpdir(), "tma-reader-")), "f.bin");
  writeFeatures(path, () => ss, norm, testSource());

  it("returns exactly what buildWindow produced, in any order", () => {
    const f = openFeatures(path);
    expect(f.count).toBe(4);
    expect([...f.indices]).toEqual([0, 1, 2, 3]);
    expect(f.norm).toEqual(norm);
    for (const k of [2, 0, 3, 1]) {
      const s = ss[k];
      if (s === undefined) throw new Error();
      expect(f.read(k)).toEqual(buildWindow(s, norm));
    }
    f.close();
  });

  it("rejects truncated and foreign files", () => {
    const buf = readFileSync(path);
    const dir = mkdtempSync(join(tmpdir(), "tma-reader-"));
    writeFileSync(join(dir, "t.bin"), buf.subarray(0, buf.length - 8));
    expect(() => openFeatures(join(dir, "t.bin"))).toThrow(/file size/);
    writeFileSync(join(dir, "x.bin"), Buffer.from("not a features file at all"));
    expect(() => openFeatures(join(dir, "x.bin"))).toThrow(/bad magic/);
  });
});
