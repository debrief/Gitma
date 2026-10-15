// scripts/train-continue.mjs: seeding a continuation with a declared config change and features
// rebuilt at a later commit (spec 003 phase B, decision 14).
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { train } from "../src/train.js";
import { tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const SCRIPT = new URL("../../../scripts/train-continue.mjs", import.meta.url).pathname;
const run = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("train-continue.mjs", () => {
  const data = tinyFeatures(16);

  it("allows only the declared keys and re-anchors the features digests to this job's files", async () => {
    const src = tempDir();
    const config = tinyConfig("mlp", { max_epochs: 2 });
    await train({
      config,
      trainPath: data.train,
      valPath: data.val,
      outDir: src,
      log: () => undefined,
    });
    const longer = join(tempDir(), "config.json");
    writeFileSync(longer, JSON.stringify({ ...config, max_epochs: 5, patience: 6 }));

    // Undeclared change: refused.
    const refused = run(src, longer, tempDir());
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/config differs in more than max_wall_s/);

    // Declared change, same data in files with a different path (stand-in for a rebuild).
    const train2 = join(tempDir(), "train.features.bin");
    const val2 = join(tempDir(), "validation.features.bin");
    copyFileSync(data.train, train2);
    copyFileSync(data.val, val2);
    const out = tempDir();
    const ok = run(
      src,
      longer,
      out,
      "--allow",
      "max_epochs,patience",
      "--train",
      train2,
      "--val",
      val2,
    );
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    const seeded = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as {
      complete: boolean;
      config: { max_epochs: number; patience: number };
      best_val_loss?: number;
      continued_from?: { weights_digest: string; best_epoch: number; val_loss: number };
    };
    expect(seeded.complete).toBe(false);
    expect(seeded.config.max_epochs).toBe(5);
    expect(seeded.config.patience).toBe(6);
    // The source is recorded (schema 0.8.2); the comparison value is left for tma-train to set.
    const srcManifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8")) as {
      weights_digest: string;
      best_epoch: number;
      epochs: { epoch: number; val_loss: number }[];
    };
    expect(seeded.best_val_loss).toBeUndefined();
    expect(seeded.continued_from).toMatchObject({
      weights_digest: srcManifest.weights_digest,
      best_epoch: srcManifest.best_epoch,
      val_loss: srcManifest.epochs.find((e) => e.epoch === srcManifest.best_epoch)?.val_loss,
    });

    // Features from another dataset: refused.
    const other = tinyFeatures(16, 9n);
    const wrong = run(
      src,
      longer,
      tempDir(),
      "--allow",
      "max_epochs,patience",
      "--train",
      other.train,
      "--val",
      other.val,
    );
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/another dataset|normalisation differs/);
  }, 120_000);

  it("a declared loss change re-scores the best epoch under the new loss (spec 004 decision 15)", async () => {
    const src = tempDir();
    const config = tinyConfig("mlp", { max_epochs: 2 });
    const first = await train({
      config,
      trainPath: data.train,
      valPath: data.val,
      outDir: src,
      log: () => undefined,
    });
    const recorded = first.epochs.find((e) => e.epoch === first.best_epoch)?.val_loss ?? NaN;
    const heavier = { ...config, max_epochs: 4, loss_weight_speed: 4 };
    const cfg = join(tempDir(), "config.json");
    writeFileSync(cfg, JSON.stringify(heavier));
    const out = tempDir();
    const seeded = run(src, cfg, out, "--allow", "max_epochs,loss_weight_speed");
    expect(seeded.stderr).toBe("");
    expect(seeded.status).toBe(0);
    const lines: string[] = [];
    const m = await train({
      config: heavier,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: (l) => lines.push(l),
    });
    const line = lines.find((l) => l.includes("re-scored under this config's loss"));
    expect(line).toBeDefined();
    const rebased = Number(/val ([\d.]+) \(recorded/.exec(line ?? "")?.[1]);
    // Speed weighted 4× can only raise the loss of the same weights.
    expect(rebased).toBeGreaterThan(recorded);
    // Every epoch after the seed is compared with the re-scored value, not the old one.
    const after = m.epochs.filter((e) => e.epoch > first.best_epoch);
    expect(after.length).toBeGreaterThan(0);
    const bestAfter = Math.min(...after.map((e) => e.val_loss));
    expect(m.best_epoch > first.best_epoch).toBe(bestAfter < rebased);
    // The comparison value is in the manifest (schema 0.8.2), with the continuation's source.
    expect(m.best_val_loss).toBe(Math.min(rebased, bestAfter));
    expect(m.continued_from?.weights_digest).toBe(first.weights_digest);
  }, 120_000);

  it("a chained job after a loss change resumes against the re-scored value (G2 2b panel, numerics)", async () => {
    const src = tempDir();
    const config = tinyConfig("mlp", { max_epochs: 2 });
    const first = await train({
      config,
      trainPath: data.train,
      valPath: data.val,
      outDir: src,
      log: () => undefined,
    });
    const recorded = first.epochs.find((e) => e.epoch === first.best_epoch)?.val_loss ?? NaN;
    const heavier = { ...config, max_epochs: first.best_epoch + 5, loss_weight_speed: 4 };
    const cfg = join(tempDir(), "config.json");
    writeFileSync(cfg, JSON.stringify(heavier));
    const out = tempDir();
    expect(run(src, cfg, out, "--allow", "max_epochs,loss_weight_speed").status).toBe(0);
    // Job 1: re-scores, trains one epoch, then dies (a runner's time limit) before the next one.
    const lines1: string[] = [];
    const killAt = first.best_epoch + 2;
    await expect(
      train({
        config: heavier,
        trainPath: data.train,
        valPath: data.val,
        outDir: out,
        log: (l) => {
          lines1.push(l);
          if (new RegExp(`epoch ${String(killAt)} train`).test(l)) throw new Error("killed");
        },
      }),
    ).rejects.toThrow(/killed/);
    const rebased = Number(
      /val ([\d.]+) \(recorded/.exec(lines1.find((l) => l.includes("re-scored")) ?? "")?.[1],
    );
    expect(rebased).toBeGreaterThan(recorded);
    const job1 = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as {
      complete: boolean;
      best_epoch: number;
      best_val_loss: number;
      epochs: { epoch: number; val_loss: number }[];
    };
    expect(job1.complete).toBe(false);
    expect(job1.epochs).toHaveLength(first.best_epoch + 2);
    const epoch1 = job1.epochs.at(-1)?.val_loss ?? NaN;
    // Persisted: the re-scored value, or the new epoch's if it beat it; never the old-loss one.
    expect(job1.best_val_loss).toBe(Math.min(rebased, epoch1));
    // Job 2: optimizer state restored, so no re-score; it must compare against the same value.
    const lines2: string[] = [];
    const m = await train({
      config: heavier,
      trainPath: data.train,
      valPath: data.val,
      outDir: out,
      log: (l) => lines2.push(l),
    });
    expect(lines2.some((l) => l.includes("optimizer state restored"))).toBe(true);
    expect(lines2.some((l) => l.includes("re-scored"))).toBe(false);
    const later = m.epochs.filter((e) => e.epoch > first.best_epoch);
    const bestLater = Math.min(...later.map((e) => e.val_loss));
    expect(m.best_val_loss).toBe(Math.min(rebased, bestLater));
    expect(m.best_epoch > first.best_epoch).toBe(bestLater < rebased);
    expect(m.complete).toBe(true);
  }, 180_000);
});
