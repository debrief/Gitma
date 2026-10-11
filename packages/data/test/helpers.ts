import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RANGES, HELDOUT_RANGES } from "@tma/sim";
import { type Format, generateDataset } from "../src/index.js";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tma-data-"));
}

export function makeDataset(seed: bigint, count: number, format: Format = "both"): string {
  const dir = tempDir();
  generateDataset({
    seed,
    count,
    outDir: dir,
    ranges: DEFAULT_RANGES,
    heldoutRanges: HELDOUT_RANGES,
    format,
    createdBy: `tma-generate --seed ${seed.toString()} --count ${String(count)}`,
  });
  return dir;
}
