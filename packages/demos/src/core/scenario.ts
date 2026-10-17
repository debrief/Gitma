// Scenarios are regenerated from their seed (spec 006 FR-001): the same `@tma/sim` function the
// pipeline's `tma-generate` calls, so no scenario files ship with the viewer.
import { generateScenario, parseSeed } from "@tma/sim";
import type { Scenario } from "@tma/types";
import type { ScenarioSource } from "./catalogue.js";

export function scenarioAt(source: ScenarioSource, index: number): Scenario {
  if (!Number.isInteger(index) || index < source.start || index >= source.end) {
    throw new RangeError(
      `${source.id}: index ${String(index)} outside [${String(source.start)}, ${String(source.end)})`,
    );
  }
  return generateScenario(parseSeed(source.seed), index, source.ranges).scenario;
}

/** Clamp an index into a source's range (for typed input and next / previous). */
export function clampIndex(source: ScenarioSource, index: number): number {
  if (!Number.isFinite(index)) return source.start;
  return Math.min(source.end - 1, Math.max(source.start, Math.trunc(index)));
}
