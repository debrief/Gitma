// scripts/generate-splits.mjs (G2 re-score tooling, SRD §7): a split generated alone is
// byte-identical, header included, to the same split of tma-generate with the same arguments,
// because every scenario is seeded by (seed, index) alone. Both run as built CLIs, in the same
// checkout, so their headers record the same provenance.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SPLITS = join(ROOT, "scripts", "generate-splits.mjs");
const GENERATE = join(ROOT, "packages", "data", "dist", "cli-generate.js");

const run = (script: string, args: string[]) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

const args = (seed: string, count: number, out: string): string[] => [
  "--seed",
  seed,
  "--count",
  String(count),
  "--ranges",
  "configs/iter4-ranges.json",
  "--heldout-ranges",
  "configs/iter4-heldout-ranges.json",
  "--out",
  out,
  "--allow-dirty",
];

describe("generate selected splits only (scripts/generate-splits.mjs)", () => {
  it("a split generated alone equals tma-generate's, byte for byte", () => {
    for (const [seed, count] of [
      ["207", 40],
      ["18446744073709551615", 23],
    ] as const) {
      const full = tempDir();
      const part = tempDir();
      expect(run(GENERATE, args(seed, count, full)).status).toBe(0);
      const r = run(SPLITS, [...args(seed, count, part), "--splits", "test,heldout"]);
      expect(r.err).toBe("");
      expect(r.status).toBe(0);
      const summary = JSON.parse(r.out) as { splits: { split: string; scenarios: number }[] };
      expect(summary.splits.map((x) => x.split)).toEqual(["test", "heldout"]);
      expect(readdirSync(part).sort()).toEqual(["heldout.f32pack", "test.f32pack"]);
      for (const f of ["test.f32pack", "heldout.f32pack"]) {
        expect(
          readFileSync(join(part, f)).equals(readFileSync(join(full, f))),
          `${seed} ${f}`,
        ).toBe(true);
      }
    }
  }, 60_000);

  it("refuses unknown or repeated splits and missing arguments", () => {
    expect(run(SPLITS, [...args("5", 20, tempDir()), "--splits", "test,bogus"]).err).toMatch(
      /unknown split "bogus"/,
    );
    expect(run(SPLITS, [...args("5", 20, tempDir()), "--splits", "test,test"]).err).toMatch(
      /names a split twice/,
    );
    const usage = run(SPLITS, args("5", 20, tempDir()));
    expect(usage.status).toBe(1);
    expect(usage.err).toMatch(/usage: generate-splits.mjs/);
    expect(run(SPLITS, [...args("5", 0, tempDir()), "--splits", "test"]).status).toBe(1);
  });
});
