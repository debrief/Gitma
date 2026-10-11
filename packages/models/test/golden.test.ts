import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { environment } from "../src/manifest.js";
import { train } from "../src/train.js";
import { KINDS, tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const GOLDEN = new URL("./golden/weights-digests.json", import.meta.url);

interface Golden {
  cpu_model: string;
  weights_digest: Record<string, string>;
  final_val_loss: Record<string, number>;
}

/** Cross-CPU drift allowed in the final validation loss (oneDNN kernel choice, research R2). */
const LOSS_REL_TOL = 1e-3;

describe("golden: models (determinism, constitution II)", () => {
  it("each model trained twice gives identical weights; matches the committed golden", async () => {
    const data = tinyFeatures(32, 11n);
    const got: Golden = {
      cpu_model: environment().cpu_model,
      weights_digest: {},
      final_val_loss: {},
    };
    for (const kind of KINDS) {
      const run = () =>
        train({
          config: tinyConfig(kind),
          trainPath: data.train,
          valPath: data.val,
          outDir: tempDir(),
          log: () => undefined,
        });
      const a = await run();
      const b = await run();
      // Same machine: byte-identical, always.
      expect(b.weights_digest).toBe(a.weights_digest);
      got.weights_digest[kind] = a.weights_digest;
      got.final_val_loss[kind] = a.epochs.at(-1)?.val_loss ?? NaN;
    }
    if (process.env.UPDATE_GOLDEN === "1")
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(existsSync(GOLDEN), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    const want = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    // Any machine: the training trajectory must match closely.
    for (const kind of KINDS) {
      const w = want.final_val_loss[kind] ?? NaN;
      expect(Math.abs((got.final_val_loss[kind] ?? NaN) - w) / w).toBeLessThan(LOSS_REL_TOL);
    }
    // The recorded CPU: weights must be byte-identical to the committed digests. Other CPUs may
    // pick different oneDNN kernels, so exact weights are only promised per CPU family.
    if (got.cpu_model === want.cpu_model) expect(got.weights_digest).toEqual(want.weights_digest);
  }, 300_000);
});
