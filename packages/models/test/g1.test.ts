import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateDataset, readDataset } from "@tma/data";
import { computeNormalisation, writeFeatures } from "@tma/features";
import { DEFAULT_RANGES } from "@tma/sim";
import type { GateVerdict, TrainingConfig } from "@tma/types";
import { describe, expect, it } from "vitest";
import { findModels, runG1 } from "../src/g1.js";
import { train } from "../src/train.js";
import { tempDir, tinyConfig } from "./helpers.js";

const quiet = () => undefined;

const CONFIGS: TrainingConfig[] = [
  tinyConfig("instantaneous", { id: "lstm", max_epochs: 1 }),
  tinyConfig("time_late", { id: "bilstm", max_epochs: 1 }),
  tinyConfig("causal_cnn", { id: "cnn", max_epochs: 1 }),
  tinyConfig("mlp", { id: "mlp", max_epochs: 1 }),
  tinyConfig("instantaneous", { id: "lstm-shuffled", max_epochs: 1, shuffle_labels: true }),
];

describe("tma-g1 end to end (tiny)", () => {
  it("scores every model beside naive and classical and writes a G1 verdict", async () => {
    const data = tempDir();
    generateDataset({
      seed: 21n,
      count: 40,
      outDir: data,
      ranges: DEFAULT_RANGES,
      heldoutRanges: DEFAULT_RANGES,
      format: "f32pack",
      createdBy: "test",
    });
    const norm = computeNormalisation(readDataset(join(data, "train.f32pack")).scenarios(), "test");
    for (const s of ["train", "validation", "test", "heldout"]) {
      writeFeatures(
        join(data, `${s}.features.bin`),
        () => readDataset(join(data, `${s}.f32pack`)).scenarios(),
        norm,
      );
    }
    const models = tempDir();
    for (const config of CONFIGS) {
      await train({
        config,
        trainPath: join(data, "train.features.bin"),
        valPath: join(data, "validation.features.bin"),
        outDir: join(models, config.id),
        log: quiet,
      });
    }
    expect(findModels(models).ids).toEqual({
      instantaneous: "lstm",
      timeLate: "bilstm",
      causalControl: "cnn",
      mlpControl: "mlp",
      shuffled: "lstm-shuffled",
    });

    const exp = join(tempDir(), "g1-test");
    const verdict = await runG1({ data, models, experiment: exp, commandLine: "test", log: quiet });
    expect(verdict.gate).toBe("G1");
    expect(verdict.checks).toHaveLength(6);
    const saved = JSON.parse(readFileSync(join(exp, "verdict.json"), "utf8")) as GateVerdict;
    expect(saved.result).toBe(verdict.result);
    const metrics = readFileSync(join(exp, "metrics.csv"), "utf8");
    for (const e of ["naive", "classical", ...CONFIGS.map((c) => c.id)]) {
      expect(metrics).toContain(`${e}:per_timestep,overall,zig+300s`);
    }
    for (const f of [
      "curves.csv",
      "manifest.json",
      "heldout/metrics.json",
      "models/lstm/weights.bin",
    ]) {
      expect(existsSync(join(exp, f))).toBe(true);
    }
    // Second run reuses the cached classical predictions and gives the same verdict.
    const again = await runG1({ data, models, experiment: exp, commandLine: "test", log: quiet });
    expect(again).toEqual(verdict);
  }, 300_000);
});
