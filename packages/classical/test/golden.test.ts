import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "@tma/data";
import { DEFAULT_RANGES } from "@tma/sim";
import type { ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { ekfPredict } from "../src/ekf.js";
import { classicalPredict } from "../src/estimate.js";
import { immPredict } from "../src/imm.js";
import { scenarios } from "./helpers.js";

const GOLDEN = new URL("./golden/seed1-classical.ndjson", import.meta.url);
const GOLDEN_TRACK = new URL("./golden/seed1-trackers.ndjson", import.meta.url);
const PHASE3 = JSON.parse(
  readFileSync(new URL("../../../configs/phase3-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;

describe("golden: classical", () => {
  it("seed 1, scenarios 0–1, final and per-timestep, byte-identical", () => {
    const lines = scenarios(1n, 2, DEFAULT_RANGES).flatMap((s) => [
      canonicalJson(classicalPredict(s, "final")),
      canonicalJson(classicalPredict(s, "per_timestep")),
    ]);
    const text = `${lines.join("\n")}\n`;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text);
    expect(existsSync(GOLDEN), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN, "utf8")).toBe(true);
  });

  it("EKF and IMM: seed 1, phase-3 scenarios 0–1 (σ 1–2°), byte-identical", () => {
    const imm = { sigmaCv: 0.003, sigmaCt: 0.03, sigmaOmega: 0.003, switchPerS: 0.001 };
    const lines = scenarios(1n, 2, PHASE3).flatMap((s) => [
      canonicalJson(ekfPredict(s, 0.03)),
      canonicalJson(immPredict(s, imm)),
    ]);
    const text = `${lines.join("\n")}\n`;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN_TRACK, text);
    expect(existsSync(GOLDEN_TRACK), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN_TRACK, "utf8")).toBe(true);
  });
});
