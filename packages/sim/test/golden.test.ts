import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { degToRad } from "../src/geometry.js";
import { DEFAULT_RANGES } from "../src/ranges.js";
import { generateScenario } from "../src/scenario.js";

const GOLDEN = new URL("./golden/seed1-3.ndjson", import.meta.url);
const GOLDEN_TURN = new URL("./golden/seed1-3-turn.ndjson", import.meta.url);
const GOLDEN_ZIG2 = new URL("./golden/seed1-3-zig2-across.ndjson", import.meta.url);
const GOLDEN_MANOEUVRE = new URL("./golden/seed1-3-manoeuvre.ndjson", import.meta.url);

describe("golden: sim", () => {
  it("seed 1, scenarios 0–2 are byte-identical to the committed golden file", () => {
    const text = [0, 1, 2]
      .map((i) => JSON.stringify(generateScenario(1n, i, DEFAULT_RANGES).scenario))
      .join("\n")
      .concat("\n");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text);
    expect(existsSync(GOLDEN), "golden file missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN, "utf8")).toBe(true);
  });

  it("with a rate-limited turn (0.5–3°/s): seed 1, scenarios 0–2 are byte-identical", () => {
    const ranges = {
      ...DEFAULT_RANGES,
      ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
    };
    const text = [0, 1, 2]
      .map((i) => JSON.stringify(generateScenario(1n, i, ranges).scenario))
      .join("\n")
      .concat("\n");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN_TURN, text);
    expect(existsSync(GOLDEN_TURN), "golden file missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN_TURN, "utf8")).toBe(true);
  });

  it("generator 0.3.0, two zigs across the line of sight: seed 1, scenarios 0–2 are byte-identical", () => {
    const ranges = {
      ...DEFAULT_RANGES,
      ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
      zig_rule: "across_los" as const,
      los_offset_rad: { min: degToRad(30), max: degToRad(90) },
      zig2_delay_s: { min: 180, max: 300 },
    };
    const text = [0, 1, 2]
      .map((i) => JSON.stringify(generateScenario(1n, i, ranges).scenario))
      .join("\n")
      .concat("\n");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN_ZIG2, text);
    expect(existsSync(GOLDEN_ZIG2), "golden file missing: run with UPDATE_GOLDEN=1").toBe(true);
    expect(text === readFileSync(GOLDEN_ZIG2, "utf8")).toBe(true);
  });

  it("generator 0.4.0, a target course change: seed 1, scenarios 0–2 are byte-identical", () => {
    const ranges = {
      ...DEFAULT_RANGES,
      ownship_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
      zig_rule: "across_los" as const,
      los_offset_rad: { min: degToRad(30), max: degToRad(90) },
      zig2_delay_s: { min: 180, max: 300 },
      target_manoeuvre_fraction: 0.8,
      target_manoeuvre_angle_abs_rad: { min: degToRad(30), max: degToRad(120) },
      target_turn_rate_rad_s: { min: degToRad(0.5), max: degToRad(3) },
      target_manoeuvre_after_zig_s: 120,
      target_manoeuvre_margin_s: 360,
    };
    const scenarios = [0, 1, 2].map((i) => generateScenario(1n, i, ranges).scenario);
    expect(scenarios.some((s) => s.metadata.manoeuvre_index !== undefined)).toBe(true);
    const text = scenarios
      .map((s) => JSON.stringify(s))
      .join("\n")
      .concat("\n");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN_MANOEUVRE, text);
    expect(existsSync(GOLDEN_MANOEUVRE), "golden file missing: run with UPDATE_GOLDEN=1").toBe(
      true,
    );
    expect(text === readFileSync(GOLDEN_MANOEUVRE, "utf8")).toBe(true);
  });
});
