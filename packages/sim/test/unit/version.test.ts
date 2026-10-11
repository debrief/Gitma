import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATOR_VERSION } from "../../src/scenario.js";

describe("GENERATOR_VERSION", () => {
  it("matches packages/sim/package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    };
    expect(GENERATOR_VERSION).toBe(pkg.version);
  });
});
