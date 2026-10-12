import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitCommit, gitDirty } from "@tma/eval";
import { describe, expect, it } from "vitest";
import { readModelManifest } from "../src/manifest-io.js";
import { train } from "../src/train.js";
import { KINDS, tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const quiet = () => undefined;

describe("training loop", () => {
  const data = tinyFeatures(48);

  it.each(KINDS)(
    "%s trains, saves weights and a complete manifest",
    async (kind) => {
      const out = tempDir();
      const m = await train({
        config: tinyConfig(kind),
        trainPath: data.train,
        valPath: data.val,
        outDir: out,
        log: quiet,
      });
      expect(m.complete).toBe(true);
      expect(m.stop_reason).toBe("max_epochs");
      expect(m.epochs).toHaveLength(2);
      expect(existsSync(join(out, "weights.bin"))).toBe(true);
      expect(existsSync(join(out, "checkpoint"))).toBe(false);
      const saved = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as {
        weights_digest: string;
      };
      expect(saved.weights_digest).toBe(m.weights_digest);
    },
    120_000,
  );

  it("stops on the wall-clock cap", async () => {
    const m = await train({
      config: tinyConfig("instantaneous", { max_epochs: 50, max_wall_s: 0 }),
      trainPath: data.train,
      valPath: data.val,
      outDir: tempDir(),
      log: quiet,
    });
    expect(m.stop_reason).toBe("wall_clock");
    expect(m.epochs).toHaveLength(1);
  }, 60_000);

  it("stops early when validation stops improving", async () => {
    const m = await train({
      config: tinyConfig("instantaneous", { max_epochs: 50, patience: 0, learning_rate: 0 }),
      trainPath: data.train,
      valPath: data.val,
      outDir: tempDir(),
      log: quiet,
    });
    expect(m.stop_reason).toBe("early_stopping");
    expect(m.epochs.length).toBeLessThan(50);
  }, 60_000);

  it("records the commit and tree state read at process start", async () => {
    const out = tempDir();
    const m = await train({
      config: tinyConfig("mlp", { max_epochs: 1 }),
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: quiet,
    });
    expect(m.git_commit).toBe(gitCommit());
    expect(m.git_dirty).toBe(gitDirty());
    const saved = readModelManifest(out);
    expect(saved.git_commit).toBe(gitCommit());
    expect(saved.git_dirty).toBe(gitDirty());
  }, 60_000);

  it("on resume keeps an earlier job's dirty flag and records this job's commit", async () => {
    // A finished one-epoch run stands in for the checkpoint of an interrupted two-epoch run.
    const first = tempDir();
    const config = tinyConfig("mlp", { max_epochs: 2 });
    const one = await train({
      config: { ...config, max_epochs: 1 },
      trainPath: data.train,
      valPath: data.val,
      outDir: first,
      log: quiet,
      source: { commit: "a".repeat(40), dirty: true },
    });
    const out = tempDir();
    for (const sub of ["checkpoint", "best"]) {
      mkdirSync(join(out, sub));
      for (const f of ["model.json", "weights.bin"]) cpSync(join(first, f), join(out, sub, f));
    }
    writeFileSync(
      join(out, "manifest.json"),
      JSON.stringify({ ...one, config, complete: false, stop_reason: undefined }),
    );
    const lines: string[] = [];
    const m = await train({
      config,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: (l) => lines.push(l),
      source: { commit: "b".repeat(40), dirty: false },
    });
    expect(m.epochs).toHaveLength(2);
    expect(m.git_commit).toBe("b".repeat(40));
    expect(m.git_dirty).toBe(true);
    expect(lines.join("\n")).toMatch(/earlier epochs were trained at commit a{40}/);
  }, 60_000);

  it("reports divergence", async () => {
    const m = await train({
      config: tinyConfig("instantaneous", { learning_rate: 1e30, loss_weight_range: 1e30 }),
      trainPath: data.train,
      valPath: data.val,
      outDir: tempDir(),
      log: quiet,
    });
    expect(m.stop_reason).toBe("diverged");
  }, 60_000);
});
