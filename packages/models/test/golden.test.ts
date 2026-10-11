import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { train } from "../src/train.js";
import { KINDS, tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const GOLDEN = new URL("./golden/weights-digests.json", import.meta.url);

describe("golden: models (determinism, constitution II)", () => {
  it("each model trained twice gives identical weights matching the committed digests", async () => {
    const data = tinyFeatures(32, 11n);
    const digests: Record<string, string> = {};
    for (const kind of KINDS) {
      const run = async () =>
        (
          await train({
            config: tinyConfig(kind),
            trainPath: data.train,
            valPath: data.val,
            outDir: tempDir(),
            log: () => undefined,
          })
        ).weights_digest;
      const a = await run();
      expect(await run()).toBe(a);
      digests[kind] = a;
    }
    if (process.env.UPDATE_GOLDEN === "1")
      writeFileSync(GOLDEN, `${JSON.stringify(digests, null, 2)}\n`);
    expect(existsSync(GOLDEN), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(digests).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  }, 300_000);
});
