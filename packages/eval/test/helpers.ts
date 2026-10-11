import { DEFAULT_RANGES, generateScenario, noiseFree } from "@tma/sim";
import type { ParameterRanges, Prediction, PredictionRow, Scenario } from "@tma/types";
import type { PredictionSet } from "../src/evaluate.js";

export const scenarios = (
  seed: bigint,
  n: number,
  r: ParameterRanges = DEFAULT_RANGES,
): Scenario[] => Array.from({ length: n }, (_, i) => generateScenario(seed, i, r).scenario);

export const NOISE_FREE = noiseFree(DEFAULT_RANGES);

/** A perfect estimate at sample i (truth echoed back). */
export function truthRow(s: Scenario, i: number): PredictionRow {
  const o = s.ownship.states[i];
  const t = s.target.states[i];
  if (o === undefined || t === undefined) throw new Error();
  return {
    timestamp_s: t.timestamp_s,
    range_m: Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m),
    course_rad: t.course_rad,
    speed_mps: t.speed_mps,
    x_m: t.x_m,
    y_m: t.y_m,
    converged: true,
  };
}

export function set(label: string, preds: Prediction[]): PredictionSet {
  return {
    label,
    estimator: label.split(":")[0] ?? label,
    byIndex: new Map(preds.map((p) => [p.scenario_index, p])),
  };
}

export const finalPred = (s: Scenario, estimator: string, row: PredictionRow): Prediction => ({
  record: "prediction",
  scenario_index: s.metadata.index,
  estimator,
  mode: "final",
  rows: [row],
});
