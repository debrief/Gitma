// Golden (constitution: every package has a fixed-seed, byte-identical golden test): the view
// model of two fixed scenarios, including the classical estimates the viewer overlays.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "@tma/data";
import { describe, expect, it } from "vitest";
import { engagementView, scenarioAt } from "../src/index.js";
import { I1_TEST, I2_TEST } from "./helpers.js";

const GOLDEN = new URL("./golden/views.ndjson", import.meta.url);

describe("golden: demos view model", () => {
  it("iteration-1 and iteration-2 test scenarios 90000, byte-identical", () => {
    const text = `${[scenarioAt(I1_TEST, 90000), scenarioAt(I2_TEST, 90000)]
      .map((s) => canonicalJson(engagementView(s)))
      .join("\n")}\n`;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text);
    expect(existsSync(GOLDEN), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN, "utf8")).toBe(true);
  });
});
