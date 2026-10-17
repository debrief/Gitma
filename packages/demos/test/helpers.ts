// Test fixtures: scenario sources built from the committed ranges files, as the site's prebuild does.
import { readFileSync } from "node:fs";
import type { ParameterRanges } from "@tma/types";
import type { ScenarioSource } from "../src/index.js";

const ROOT = new URL("../../../", import.meta.url);
export const repoPath = (p: string): string => new URL(p, ROOT).pathname;
export const ranges = (file: string): ParameterRanges =>
  JSON.parse(readFileSync(repoPath(`configs/${file}`), "utf8")) as ParameterRanges;

export const I2_TEST: ScenarioSource = {
  id: "i2-test",
  label: "Iteration 2 test",
  seed: "201",
  start: 90000,
  end: 100000,
  ranges: ranges("iter2-ranges.json"),
};
export const I1_TEST: ScenarioSource = {
  id: "i1-test",
  label: "Iteration 1 test",
  seed: "101",
  start: 90000,
  end: 100000,
  ranges: ranges("iter1-ranges.json"),
};
