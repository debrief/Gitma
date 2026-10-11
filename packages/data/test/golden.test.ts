import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeDataset } from "./helpers.js";

const DIR = new URL("./golden/", import.meta.url);
const DIGESTS = new URL("digests.json", DIR);
const TEST_NDJSON = new URL("seed1-count10-test.ndjson", DIR);
const FILES = ["train", "validation", "test", "heldout"].flatMap((s) => [
  `${s}.ndjson`,
  `${s}.f32pack`,
]);

describe("golden: data", () => {
  it("seed 1, count 10: every output file is byte-identical to the committed golden", () => {
    const dir = makeDataset(1n, 10);
    const digests = Object.fromEntries(
      FILES.map((f) => [f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")]),
    );
    const testText = readFileSync(join(dir, "test.ndjson"), "utf8");
    if (process.env.UPDATE_GOLDEN === "1") {
      writeFileSync(DIGESTS, `${JSON.stringify(digests, null, 2)}\n`);
      writeFileSync(TEST_NDJSON, testText);
    }
    expect(existsSync(DIGESTS), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(digests).toEqual(JSON.parse(readFileSync(DIGESTS, "utf8")));
    expect(testText === readFileSync(TEST_NDJSON, "utf8")).toBe(true);
  });
});
