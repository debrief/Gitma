import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("resumes an interrupted run from its checkpoint, even mid-swap (CI checkpoints)", async () => {
    const out = tempDir();
    const config = tinyConfig("instantaneous", { max_epochs: 3 });
    let lines = 0;
    // Interrupt during epoch 1, after epoch 0's checkpoint and manifest were written.
    await expect(
      train({
        config,
        trainPath: data.train,
        valPath: data.val,
        outDir: out,
        log: () => {
          if (++lines === 2) throw new Error("job cancelled");
        },
      }),
    ).rejects.toThrow("job cancelled");
    const partial = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as {
      complete: boolean;
      epochs: unknown[];
    };
    expect(partial.complete).toBe(false);
    expect(partial.epochs).toHaveLength(1);
    // A sync taken during the atomic swap only has checkpoint.old.
    renameSync(join(out, "checkpoint"), join(out, "checkpoint.old"));
    const resumed: string[] = [];
    const m = await train({
      config,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: (l) => resumed.push(l),
    });
    expect(resumed[0]).toMatch(/resuming .* after epoch 0/);
    expect(m.complete).toBe(true);
    expect(m.epochs.map((e) => e.epoch)).toEqual([0, 1, 2]);
    for (const d of ["checkpoint", "checkpoint.old", "best", "best.tmp"]) {
      expect(existsSync(join(out, d))).toBe(false);
    }
  }, 120_000);
});
