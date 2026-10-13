// Model-versus-reference comparison on common rows (spec 003 R9, FR-017; reported, not gated).
// Scoring a missing estimate as +∞ is right for a single estimator's medians, but it makes a
// reference's P90 infinite once its non-convergence passes 10%, which hides the comparison. Here
// each pair is compared only on rows both answered, and each one's coverage is reported beside it.
import type { PairedComparison, Scenario } from "@tma/types";
import { type RowError, rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { sliceKeys } from "./slices.js";
import { ascending, median, percentile } from "./stats.js";

/** An estimate counts as answered when it converged and every error is finite. */
export const answered = (e: RowError): boolean =>
  e.converged &&
  Number.isFinite(e.range_rel) &&
  Number.isFinite(e.course_deg) &&
  Number.isFinite(e.speed_kt);

interface Pair {
  scored: number;
  scoredRef: number;
  answered: number;
  answeredRef: number;
  common: [RowError, RowError][];
}

const sliceOrder = (a: string, b: string): number =>
  a === b ? 0 : a === "overall" ? -1 : b === "overall" ? 1 : a < b ? -1 : 1;

/** The row scored at the point (the last row for "final"), or undefined when there is none. */
function rowAt(errs: RowError[], seconds: number | undefined): RowError | undefined {
  if (seconds === undefined) return errs.at(-1);
  return errs.find((e) => Math.abs(e.t_since_zig_s - seconds) < 1e-6);
}

function finiteOnly<T extends object>(r: T): T {
  return Object.fromEntries(
    Object.entries(r).filter(([, v]) => typeof v !== "number" || Number.isFinite(v)),
  ) as T;
}

/**
 * Every estimator except `reference` against `reference`, per slice, at "final" and at each
 * `zig+<n>s` point. A row is scored for an estimator when it emitted a row at the point; it is
 * answered when that row converged with finite errors. Metrics use only rows both answered.
 */
export function compareOnCommonRows(
  truth: Iterable<Scenario>,
  sets: PredictionSet[],
  reference: string,
  points: number[],
): PairedComparison[] {
  const ref = sets.find((s) => s.label === reference);
  if (ref === undefined) throw new Error(`--compare-to ${reference}: no such estimator`);
  const others = sets.filter((s) => s !== ref);
  const pointDefs: [string, number | undefined][] = [
    ["final", undefined],
    ...points.map((p): [string, number] => [`zig+${String(p)}s`, p]),
  ];
  // pairs[label][point][slice]
  const pairs = new Map<string, Map<string, Map<string, Pair>>>();
  const pair = (label: string, point: string, slice: string): Pair => {
    let byPoint = pairs.get(label);
    if (byPoint === undefined) pairs.set(label, (byPoint = new Map<string, Map<string, Pair>>()));
    let bySlice = byPoint.get(point);
    if (bySlice === undefined) byPoint.set(point, (bySlice = new Map<string, Pair>()));
    let p = bySlice.get(slice);
    if (p === undefined) {
      p = { scored: 0, scoredRef: 0, answered: 0, answeredRef: 0, common: [] };
      bySlice.set(slice, p);
    }
    return p;
  };
  const errorsOf = (s: Scenario, set: PredictionSet): RowError[] => {
    const p = set.byIndex.get(s.metadata.index);
    if (p === undefined)
      throw new Error(`${set.label}: no prediction for scenario ${String(s.metadata.index)}`);
    return p.rows.map((r) => rowError(s, r));
  };

  for (const s of truth) {
    const keys = sliceKeys(s.metadata);
    const refErrs = errorsOf(s, ref);
    for (const set of others) {
      const errs = errorsOf(s, set);
      for (const [point, sec] of pointDefs) {
        const e = rowAt(errs, sec);
        const r = rowAt(refErrs, sec);
        for (const k of keys) {
          const p = pair(set.label, point, k);
          if (e !== undefined) {
            p.scored++;
            if (answered(e)) p.answered++;
          }
          if (r !== undefined) {
            p.scoredRef++;
            if (answered(r)) p.answeredRef++;
          }
          if (e !== undefined && r !== undefined && answered(e) && answered(r))
            p.common.push([e, r]);
        }
      }
    }
  }

  const out: PairedComparison[] = [];
  for (const set of others) {
    const byPoint = pairs.get(set.label);
    if (byPoint === undefined) continue;
    for (const [point] of pointDefs) {
      const bySlice = byPoint.get(point);
      if (bySlice === undefined) continue;
      for (const slice of [...bySlice.keys()].sort(sliceOrder)) {
        const p = bySlice.get(slice);
        // An estimator with no row at this point (a final-mode file at zig+300s) is not compared.
        if (p === undefined || p.scored === 0 || p.scoredRef === 0) continue;
        out.push(record(set.label, reference, slice, point, p));
      }
    }
  }
  return out;
}

function record(
  estimator: string,
  reference: string,
  slice: string,
  point: string,
  p: Pair,
): PairedComparison {
  const base: PairedComparison = {
    estimator,
    reference,
    slice,
    point,
    n_common: p.common.length,
    coverage_estimator: p.answered / p.scored,
    coverage_reference: p.answeredRef / p.scoredRef,
  };
  if (p.common.length === 0) return base;
  const col = (side: 0 | 1, f: (e: RowError) => number): number[] =>
    ascending(p.common.map((c) => f(c[side])));
  const gross = (side: 0 | 1): number =>
    p.common.filter((c) => c[side].gross).length / p.common.length;
  const rr = col(0, (e) => e.range_rel);
  const rrRef = col(1, (e) => e.range_rel);
  return finiteOnly({
    ...base,
    range_rel_median: median(rr),
    range_rel_median_ref: median(rrRef),
    range_rel_p90: percentile(rr, 0.9),
    range_rel_p90_ref: percentile(rrRef, 0.9),
    course_deg_median: median(col(0, (e) => e.course_deg)),
    course_deg_median_ref: median(col(1, (e) => e.course_deg)),
    speed_kt_median: median(col(0, (e) => e.speed_kt)),
    speed_kt_median_ref: median(col(1, (e) => e.speed_kt)),
    gross_error_rate: gross(0),
    gross_error_rate_ref: gross(1),
  });
}
