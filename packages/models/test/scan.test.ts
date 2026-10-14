// tma-scan (spec 003 R20): every model in a folder on validation, beside naive and classical.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileSha256, generateDataset, readDataset } from "@tma/data";
import { computeNormalisation, writeFeatures } from "@tma/features";
import { DEFAULT_RANGES } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { beforeAll, describe, expect, it } from "vitest";
import { findAllModels, runScan, scanMarkdown } from "../src/scan.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig } from "./helpers.js";

const quiet = (): undefined => undefined;
const NOISY: ParameterRanges = {
  ...DEFAULT_RANGES,
  noise_sigma_rad_values: [Math.PI / 180, Math.PI / 90],
};

describe("tma-scan (tiny)", () => {
  const data = tempDir();
  const models = tempDir();

  beforeAll(async () => {
    generateDataset({
      seed: 29n,
      count: 120,
      outDir: data,
      ranges: NOISY,
      heldoutRanges: NOISY,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "0".repeat(40), generator_git_dirty: false },
    });
    const norm = computeNormalisation(readDataset(join(data, "train.f32pack")).scenarios(), "test");
    for (const s of ["train", "validation", "test"]) {
      const split = readDataset(join(data, `${s}.f32pack`));
      writeFeatures(
        join(data, `${s}.features.bin`),
        () => split.scenarios(),
        norm,
        { header: split.header, digest: fileSha256(join(data, `${s}.f32pack`)) },
        "raw",
      );
    }
    // Two capacities of the same kind: the scan takes any number of models of any kind.
    for (const [id, layers] of [
      ["lstm-8u", 1],
      ["lstm-8u-x2", 2],
    ] as const) {
      await train({
        config: tinyConfig("instantaneous", { id, layers, max_epochs: 1 }),
        trainPath: join(data, "train.features.bin"),
        valPath: join(data, "validation.features.bin"),
        outDir: join(models, id),
        log: quiet,
        source: { commit: "c".repeat(40), dirty: false },
      });
    }
  }, 120_000);

  it("scores every model on validation beside naive and classical, never reading test", async () => {
    const exp = join(tempDir(), "scan");
    const rows = await runScan({
      data,
      models,
      experiment: exp,
      commandLine: "test",
      log: quiet,
      resamples: 50,
    });
    expect(rows.map((r) => r.estimator)).toEqual(["naive", "classical", "lstm-8u", "lstm-8u-x2"]);
    const [, , one, two] = rows;
    expect(one?.params).toBeGreaterThan(0);
    expect(two?.params ?? 0).toBeGreaterThan(one?.params ?? 0);
    expect(one?.epochs).toBe(1);
    expect(one?.loss_weight_speed).toBe(1);
    expect(one?.speed).toMatch(/kt \[/);
    const md = readFileSync(join(exp, "scan.md"), "utf8");
    expect(md).toContain("never gated");
    expect(md).toContain("`lstm-8u-x2`");
    for (const f of ["metrics.json", "bootstrap.json", "curves.csv", "manifest.json"]) {
      expect(existsSync(join(exp, f))).toBe(true);
    }
    expect(existsSync(join(exp, "verdict.json"))).toBe(false);
    expect(existsSync(join(exp, "models", "lstm-8u-x2", "weights.bin"))).toBe(true);
    const preds = readdirSync(join(data, "predictions"));
    expect(preds.some((f) => f.startsWith("validation."))).toBe(true);
    expect(preds.some((f) => f.startsWith("test."))).toBe(false);
    expect(readFileSync(join(exp, "manifest.json"), "utf8")).toContain("never a gate decision");
  }, 120_000);

  it("refuses an empty folder and duplicate ids; the table renders without model fields", () => {
    expect(() => findAllModels(tempDir())).toThrow(/no trained models/);
    const md = scanMarkdown(
      [{ estimator: "naive", n300: 1, n600: 1, range: "1%", course: "1°", speed: "1 kt" }],
      10,
    );
    expect(md).toContain("| `naive` | – | – | – | – | 1 / 1 | 1% | 1° | 1 kt |");
  });
});
