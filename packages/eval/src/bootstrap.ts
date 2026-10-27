// Seeded percentile bootstrap intervals over scenarios.
// - Paired median-error ratio (G1 report, spec 002 T033; G0 panel round 2): scenarios are
//   resampled with replacement, the same draw for both estimators, so the interval reflects the
//   comparison on one test set rather than two independent ones.
// - Single median against an absolute threshold (G2, spec 003 R8, T028).
import { createRng, uniformInt } from "@tma/sim";
import type { Scenario } from "@tma/types";
import { z } from "zod";
import { type RowError, rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { sliceKeys } from "./slices.js";
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
 * One error metric of two estimators on the scenarios where both have a row `seconds` after the
 * zig (non-converged rows count as +Infinity, as everywhere else).
 */
export function pairedErrors(
  truth: Iterable<Scenario>,
  a: PredictionSet,
  b: PredictionSet,
  seconds: number,
  metric: "range_rel" | "course_deg" | "speed_kt",
): { a: Float64Array; b: Float64Array } {
  const ea: number[] = [];
  const eb: number[] = [];
  const at = (s: Scenario, set: PredictionSet): number | undefined => {
    const p = set.byIndex.get(s.metadata.index);
    if (p === undefined)
      throw new Error(`${set.label}: no prediction for ${String(s.metadata.index)}`);
    for (const row of p.rows) {
      const e = rowError(s, row);
      if (Math.abs(e.t_since_zig_s - seconds) < 1e-6) return e.converged ? e[metric] : Infinity;
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

/** Range errors of two estimators (the G1 ratio's inputs). */
export const pairedRangeErrors = (
  truth: Iterable<Scenario>,
  a: PredictionSet,
  b: PredictionSet,
  seconds: number,
): { a: Float64Array; b: Float64Array } => pairedErrors(truth, a, b, seconds, "range_rel");

const sortedMedian = (xs: Float64Array): number => median(ascending(Array.from(xs)));

/** NaN (and a missing value) ranks as +Infinity, as in `ascending`. */
const nanToInf = (v: number | undefined): number =>
  v === undefined || Number.isNaN(v) ? Infinity : v;

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
      ra[i] = nanToInf(a[k]);
      rb[i] = nanToInf(b[k]);
    }
    // Same nearest-rank medians as sorting, by selection (spec 003: faster for G2's many CIs).
    ratios.push(selectMedian(ra) / selectMedian(rb));
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

/**
 * Nearest-rank median (rank ⌈n/2⌉, as `median` in stats.ts) by in-place selection: `buf` is
 * reordered. NaN must already be mapped to +Infinity. O(n) on average, versus a sort per resample.
 */
export function selectMedian(buf: Float64Array): number {
  return selectQuantile(buf, 0.5);
}

/** Nearest-rank quantile q ∈ (0, 1] (rank max(1, ⌈q·n⌉), as `percentile`), by in-place selection. */
export function selectQuantile(buf: Float64Array, q: number): number {
  const n = buf.length;
  if (n === 0) return NaN;
  const k = Math.max(1, Math.ceil(q * n)) - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    // Median-of-three pivot (deterministic; no Math.random).
    const mid = (lo + hi) >>> 1;
    const a = buf[lo] ?? 0;
    const b = buf[mid] ?? 0;
    const c = buf[hi] ?? 0;
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((buf[i] ?? 0) < pivot) i++;
      while ((buf[j] ?? 0) > pivot) j--;
      if (i <= j) {
        const t = buf[i] ?? 0;
        buf[i] = buf[j] ?? 0;
        buf[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return buf[k] ?? NaN;
}

export interface MedianInterval {
  /** Median of the full sample (nearest rank). */
  median: number;
  /** 2.5th and 97.5th percentiles of the bootstrap medians (nearest rank). */
  lo: number;
  hi: number;
  n: number;
  resamples: number;
  seed: string;
}

/**
 * Seeded percentile bootstrap 95% interval of a single median (T028). One value per scenario,
 * so resampling values is resampling scenarios. NaN counts as +Infinity, as in `ascending`.
 */
export function bootstrapMedian(
  xs: Float64Array,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): MedianInterval {
  const n = xs.length;
  if (n === 0) throw new Error("bootstrap needs a non-empty sample");
  const x = xs.map(nanToInf);
  const rng = createRng(seed);
  const medians: number[] = [];
  const r = new Float64Array(n);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < n; i++) r[i] = nanToInf(x[uniformInt(rng, n)]);
    medians.push(selectMedian(r));
  }
  const sorted = ascending(medians);
  return {
    median: sortedMedian(x),
    lo: percentile(sorted, 0.025),
    hi: percentile(sorted, 0.975),
    n,
    resamples,
    seed: seed.toString(),
  };
}

// ---------------------------------------------------------------------------------------------
// bootstrap.json written by `tma-eval --bootstrap` and read by `tma-gate g2` (contracts/cli.md).
// Non-finite values (a median over mostly non-converged rows) cannot be held in JSON and are left
// absent; readers treat an absent value as +Infinity (errors are non-negative), which can only
// make a check fail or stay inconclusive.

export const INTERVAL_LEVEL = 0.95;

/** Error metrics with bootstrap intervals; G2 gates the medians of all three. */
export const INTERVAL_METRICS = ["range_rel", "course_deg", "speed_kt"] as const;
export type IntervalMetric = (typeof INTERVAL_METRICS)[number];

const optNumber = z.number().optional();

// Report-file shapes local to this package, like RatioInterval above (spec 002's bootstrap.json
// had no schema class either); the pipeline's data records stay in schema/tma.yaml.
export const MedianIntervalRecord = z.strictObject({
  estimator: z.string(),
  slice: z.string(),
  point: z.string(),
  metric: z.enum(INTERVAL_METRICS),
  n: z.number().int(),
  median: optNumber,
  lo: optNumber,
  hi: optNumber,
});
export type MedianIntervalRecord = z.infer<typeof MedianIntervalRecord>;

export const RatioIntervalRecord = z.strictObject({
  estimator: z.string(),
  reference: z.string(),
  slice: z.string(),
  point: z.string(),
  metric: z.literal("range_rel"),
  n: z.number().int(),
  ratio: optNumber,
  lo: optNumber,
  hi: optNumber,
});
export type RatioIntervalRecord = z.infer<typeof RatioIntervalRecord>;

export const BootstrapReport = z.strictObject({
  level: z.number(),
  resamples: z.number().int(),
  seed: z.string(),
  method: z.string(),
  medians: z.array(MedianIntervalRecord),
  ratios: z.array(RatioIntervalRecord),
});
export type BootstrapReport = z.infer<typeof BootstrapReport>;

export interface BootstrapOptions {
  /** Seconds after the zig (the per-timestep points scored by tma-eval). */
  points: number[];
  resamples: number;
  seed: bigint;
  /** Label of the reference for ratio intervals (G1's model/naive). */
  reference: string;
}

/** Intervals are computed for the overall slice and the noise-σ slices (the G2 slice). */
const intervalSlice = (key: string): boolean => key === "overall" || key.startsWith("sigma=");

const finite = (v: number): number | undefined => (Number.isFinite(v) ? v : undefined);

/** Drops absent (non-finite) fields so the record holds only JSON numbers. */
function compact<T extends object>(r: T): T {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as T;
}

const sliceOrder = (a: string, b: string): number =>
  a === b ? 0 : a === "overall" ? -1 : b === "overall" ? 1 : a < b ? -1 : 1;

/**
 * Bootstrap intervals for every per-timestep estimator at each point, on the overall and σ
 * slices: a single-median interval per error metric and, for every estimator but the reference,
 * a paired interval of its median range error over the reference's (overall slice). Each interval
 * restarts the PRNG from `seed`, so an interval does not depend on which others were computed.
 */
export function bootstrapEvaluation(
  truth: Iterable<Scenario>,
  sets: PredictionSet[],
  opts: BootstrapOptions,
): BootstrapReport {
  const perTimestep = sets.filter((s) => s.label.endsWith(":per_timestep"));
  // rows[label][point] = per-scenario error at the point (undefined: no row, i.e. excluded).
  const rows = new Map<string, Map<number, (RowError | undefined)[]>>();
  const keys: string[][] = [];
  for (const set of perTimestep) {
    rows.set(set.label, new Map(opts.points.map((p) => [p, [] as (RowError | undefined)[]])));
  }
  for (const s of truth) {
    keys.push(sliceKeys(s.metadata).filter(intervalSlice));
    for (const set of perTimestep) {
      const p = set.byIndex.get(s.metadata.index);
      if (p === undefined)
        throw new Error(`${set.label}: no prediction for scenario ${String(s.metadata.index)}`);
      const errs = p.rows.map((r) => rowError(s, r));
      for (const sec of opts.points) {
        const e = errs.find((x) => Math.abs(x.t_since_zig_s - sec) < 1e-6);
        rows.get(set.label)?.get(sec)?.push(e);
      }
    }
  }
  const slices = [...new Set(keys.flat())].sort(sliceOrder);
  const at = (label: string, sec: number): (RowError | undefined)[] =>
    rows.get(label)?.get(sec) ?? [];

  const medians: MedianIntervalRecord[] = [];
  const ratios: RatioIntervalRecord[] = [];
  for (const set of perTimestep) {
    for (const sec of opts.points) {
      const point = `zig+${String(sec)}s`;
      const errs = at(set.label, sec);
      for (const slice of slices) {
        const inSlice = errs.filter(
          (e, i): e is RowError => e !== undefined && (keys[i]?.includes(slice) ?? false),
        );
        if (inSlice.length === 0) continue;
        for (const metric of INTERVAL_METRICS) {
          const ci = bootstrapMedian(
            Float64Array.from(inSlice, (e) => e[metric]),
            opts.resamples,
            opts.seed,
          );
          medians.push(
            compact({
              estimator: set.label,
              slice,
              point,
              metric,
              n: ci.n,
              median: finite(ci.median),
              lo: finite(ci.lo),
              hi: finite(ci.hi),
            }),
          );
        }
      }
      if (set.label === opts.reference || !rows.has(opts.reference)) continue;
      const ref = at(opts.reference, sec);
      const a: number[] = [];
      const b: number[] = [];
      errs.forEach((e, i) => {
        const r = ref[i];
        if (e === undefined || r === undefined) return;
        a.push(e.range_rel);
        b.push(r.range_rel);
      });
      if (a.length === 0) continue;
      const ci = bootstrapMedianRatio(
        Float64Array.from(a),
        Float64Array.from(b),
        opts.resamples,
        opts.seed,
      );
      ratios.push(
        compact({
          estimator: set.label,
          reference: opts.reference,
          slice: "overall",
          point,
          metric: "range_rel" as const,
          n: ci.n,
          ratio: finite(ci.ratio),
          lo: finite(ci.lo),
          hi: finite(ci.hi),
        }),
      );
    }
  }
  return {
    level: INTERVAL_LEVEL,
    resamples: opts.resamples,
    seed: opts.seed.toString(),
    method: "percentile bootstrap over scenarios; nearest-rank 2.5th and 97.5th percentiles",
    medians,
    ratios,
  };
}

/**
 * Seeded paired bootstrap of quantile_q(a) / quantile_q(b) (spec 009, G3: the median and the
 * 90th percentile of the hybrid against classical). q = 0.5 is `bootstrapMedianRatio`.
 */
export function bootstrapQuantileRatio(
  a: Float64Array,
  b: Float64Array,
  q: number,
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
      ra[i] = nanToInf(a[k]);
      rb[i] = nanToInf(b[k]);
    }
    ratios.push(selectQuantile(ra, q) / selectQuantile(rb, q));
  }
  const sorted = ascending(ratios);
  return {
    ratio: percentile(ascending(Array.from(a)), q) / percentile(ascending(Array.from(b)), q),
    lo: percentile(sorted, 0.025),
    hi: percentile(sorted, 0.975),
    n,
    resamples,
    seed: seed.toString(),
  };
}

export interface DifferenceInterval {
  /** mean(a) − mean(b) on the full sample. */
  difference: number;
  /** 2.5th and 97.5th percentiles of the bootstrap differences (nearest rank). */
  lo: number;
  hi: number;
  n: number;
  resamples: number;
  seed: string;
}

/**
 * Seeded paired bootstrap of rate(a) − rate(b) for two 0/1 indicators on the same scenarios
 * (spec 009, G3: the hybrid's gross-error rate against classical's).
 */
export function bootstrapRateDifference(
  a: Uint8Array,
  b: Uint8Array,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): DifferenceInterval {
  const n = a.length;
  if (n === 0 || b.length !== n) throw new Error("bootstrap needs two equal, non-empty samples");
  const rng = createRng(seed);
  const diffs: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let d = 0;
    for (let i = 0; i < n; i++) {
      const k = uniformInt(rng, n);
      d += (a[k] ?? 0) - (b[k] ?? 0);
    }
    diffs.push(d / n);
  }
  let full = 0;
  for (let i = 0; i < n; i++) full += (a[i] ?? 0) - (b[i] ?? 0);
  const sorted = ascending(diffs);
  return {
    difference: full / n,
    lo: percentile(sorted, 0.025),
    hi: percentile(sorted, 0.975),
    n,
    resamples,
    seed: seed.toString(),
  };
}
