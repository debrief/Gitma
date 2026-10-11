import { DEFAULT_RANGES, generateScenario, noiseFree } from "@tma/sim";
import type { ParameterRanges, Scenario } from "@tma/types";

export function scenarios(seed: bigint, n: number, ranges: ParameterRanges): Scenario[] {
  return Array.from({ length: n }, (_, i) => generateScenario(seed, i, ranges).scenario);
}

export const NOISE_FREE = noiseFree(DEFAULT_RANGES);

/** Truth at sample i: range, course, speed of the target relative to ownship. */
export function truthAt(s: Scenario, i: number): { range: number; course: number; speed: number } {
  const o = s.ownship.states[i];
  const t = s.target.states[i];
  if (o === undefined || t === undefined) throw new Error(`no sample ${String(i)}`);
  return {
    range: Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m),
    course: t.course_rad,
    speed: t.speed_mps,
  };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}
