// FR-001: the viewer's core bundles for the browser (no Node built-ins) and, run in a bare
// context, regenerates scenarios and classical estimates byte-identically with Node.
import { runInNewContext } from "node:vm";
import { canonicalJson } from "@tma/data";
import { classicalPredict } from "@tma/classical";
import { generateScenario, parseSeed } from "@tma/sim";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { I1_TEST, I2_TEST, repoPath } from "./helpers.js";

const src = (p: string): string => repoPath(`packages/${p}`);
const ALIAS: Record<string, string> = {
  "@tma/types": src("types/src/index.ts"),
  "@tma/sim": src("sim/src/index.ts"),
  "@tma/features/browser": src("features/src/browser.ts"),
  "@tma/classical/browser": src("classical/src/browser.ts"),
  "@tma/eval/browser": src("eval/src/browser.ts"),
  "@tma/data/canonical": src("data/src/canonical.ts"),
};

describe("browser bundle (FR-001)", () => {
  it("bundles with platform browser and regenerates scenarios byte-identically", async () => {
    const out = await build({
      entryPoints: [src("demos/src/index.ts")],
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "TMA",
      write: false,
      alias: ALIAS,
      logLevel: "silent",
    });
    const code = out.outputFiles[0]?.text ?? "";
    expect(code).not.toMatch(/require\(["']node:/);
    const ctx: { TMA?: Record<string, (...a: unknown[]) => unknown> } = {};
    runInNewContext(code, ctx);
    const tma = ctx.TMA;
    if (tma === undefined) throw new Error("bundle did not define TMA");
    for (const [source, index] of [
      [I2_TEST, 90000],
      [I2_TEST, 95555],
      [I1_TEST, 90042],
    ] as const) {
      const browser = tma.scenarioAt?.(source, index);
      const node = generateScenario(parseSeed(source.seed), index, source.ranges).scenario;
      expect(canonicalJson(browser)).toBe(canonicalJson(node));
      expect(canonicalJson(tma.classicalRows?.(browser))).toBe(
        canonicalJson(classicalPredict(node, "per_timestep")),
      );
    }
  }, 120_000);
});
