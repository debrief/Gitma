// Paired bootstrap of a median-error ratio (G1 report, spec 002 T033; G0 panel round 2).
// Scenarios are resampled with replacement, the same draw for both estimators, so the interval
// reflects the comparison on one test set rather than two independent ones.
import { createRng, uniformInt } from "@tma/sim";
import type { Scenario } from "@tma/types";
import { rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { ascending, median, percentile } from "./stats.js";

export interface RatioInterval {
  /** median(a) / median(b) on the full sample. */
  ratio: number;
  /** 2.5th and 97.5th percentiles of the bootstrap ratios (nearest rank). */
  lo: number;
  hi: number;
  n: number;
  resamples: number;
  seed: string;
}

export const BOOTSTRAP_RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 20261011n;

/**
 * Range errors of two estimators on the scenarios where both have a row `seconds` after the zig
 * (non-converged rows count as +Infinity, as everywhere else).
 */
export function pairedRangeErrors(
  truth: Iterable<Scenario>,
  a: PredictionSet,
  b: PredictionSet,
  seconds: number,
): { a: Float64Array; b: Float64Array } {
  const ea: number[] = [];
  const eb: number[] = [];
  const at = (s: Scenario, set: PredictionSet): number | undefined => {
    const p = set.byIndex.get(s.metadata.index);
    if (p === undefined)
      throw new Error(`${set.label}: no prediction for ${String(s.metadata.index)}`);
    for (const row of p.rows) {
      const e = rowError(s, row);
      if (Math.abs(e.t_since_zig_s - seconds) < 1e-6) return e.range_rel;
    }
    return undefined;
  };
  for (const s of truth) {
    const x = at(s, a);
    const y = at(s, b);
    if (x === undefined || y === undefined) continue;
    ea.push(x);
    eb.push(y);
  }
  return { a: Float64Array.from(ea), b: Float64Array.from(eb) };
}

const sortedMedian = (xs: Float64Array): number => median(ascending(Array.from(xs)));

/** Seeded paired bootstrap of median(a) / median(b). */
export function bootstrapMedianRatio(
  a: Float64Array,
  b: Float64Array,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): RatioInterval {
  const n = a.length;
  if (n === 0 || b.length !== n) throw new Error("bootstrap needs two equal, non-empty samples");
  const rng = createRng(seed);
  const ratios: number[] = [];
  const ra = new Float64Array(n);
  const rb = new Float64Array(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) {
      const k = uniformInt(rng, n);
      ra[i] = a[k] ?? NaN;
      rb[i] = b[k] ?? NaN;
    }
    ratios.push(sortedMedian(ra) / sortedMedian(rb));
  }
  const sorted = ascending(ratios);
  return {
    ratio: sortedMedian(a) / sortedMedian(b),
    lo: percentile(sorted, 0.025),
    hi: percentile(sorted, 0.975),
    n,
    resamples,
    seed: seed.toString(),
  };
}
