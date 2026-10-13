import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RANGES, HELDOUT_RANGES } from "@tma/sim";
import { type Format, generateDataset } from "../src/index.js";

/** Fixed header provenance, so golden files do not depend on the checkout's commit. */
export const TEST_PROVENANCE = {
  generator_git_commit: "0123456789abcdef0123456789abcdef01234567",
  generator_git_dirty: false,
};

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
    provenance: TEST_PROVENANCE,
  });
  return dir;
}
