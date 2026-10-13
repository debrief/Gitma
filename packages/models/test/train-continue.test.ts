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
    };
    expect(seeded.complete).toBe(false);
    expect(seeded.config.max_epochs).toBe(5);
    expect(seeded.config.patience).toBe(6);

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
});
