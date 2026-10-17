// A scenario's view model without the models (golden-tested): what the plan and plots draw.
import type { Prediction, Scenario } from "@tma/types";
import { classicalRows } from "./estimates.js";
import { type Bounds, boundsOf, gridStep } from "./geometry.js";
import { type Legs, legsOf, type Series, seriesOf } from "./series.js";

export interface EngagementView {
  index: number;
  seed: string;
  legs: Legs;
  bounds: Bounds;
  gridStepM: number;
  series: Series;
  classical: Prediction;
}

export function engagementView(s: Scenario): EngagementView {
  const pts: [number, number][] = [];
  for (const p of [...s.ownship.states, ...s.target.states]) pts.push([p.x_m, p.y_m]);
  const bounds = boundsOf(pts);
  return {
    index: s.metadata.index,
    seed: s.metadata.seed,
    legs: legsOf(s),
    bounds,
    gridStepM: gridStep(bounds.maxX - bounds.minX),
    series: seriesOf(s),
    classical: classicalRows(s),
  };
}
