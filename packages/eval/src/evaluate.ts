// Scores prediction files against a truth split: metrics by slice and point, plus curves.
import type { CurvePoint, MetricsRecord, Prediction, Scenario } from "@tma/types";
import { type RowError, rowError } from "./errors.js";
import { sliceKeys } from "./slices.js";
import { ascending, mean, median, percentile } from "./stats.js";

export interface PredictionSet {
  /** Label used in reports: estimator name, suffixed ":per_timestep" for per-timestep files. */
  label: string;
  estimator: string;
  byIndex: Map<number, Prediction>;
}

export interface EvaluateOptions {
  /** Seconds after the zig at which per-timestep predictions are also scored (gate point = 300). */
  points: number[];
  /** Curve resolution in seconds since the zig. */
  curveStep: number;
}

export const DEFAULT_EVALUATE_OPTIONS: EvaluateOptions = { points: [300], curveStep: 60 };

export interface Evaluation {
  metrics: MetricsRecord[];
  curves: CurvePoint[];
}

interface Bucket {
  errors: RowError[];
  excluded: number;
}

function record(label: string, slice: string, point: string, b: Bucket): MetricsRecord {
  const rr = ascending(b.errors.map((e) => e.range_rel));
  const cd = ascending(b.errors.map((e) => e.course_deg));
  const sk = ascending(b.errors.map((e) => e.speed_kt));
  const n = b.errors.length;
  const base: MetricsRecord = { estimator: label, slice, point, n, excluded: b.excluded };
  if (n === 0) return base;
  return {
    ...base,
    range_rel_median: median(rr),
    range_rel_p90: percentile(rr, 0.9),
    course_deg_median: median(cd),
    course_deg_p90: percentile(cd, 0.9),
    speed_kt_median: median(sk),
    speed_kt_p90: percentile(sk, 0.9),
    gross_error_rate: b.errors.filter((e) => e.gross).length / n,
    position_m_mean: mean(b.errors.map((e) => e.position_m)),
  };
}

export function evaluate(
  truth: Iterable<Scenario>,
  sets: PredictionSet[],
  opts: EvaluateOptions = DEFAULT_EVALUATE_OPTIONS,
): Evaluation {
  // buckets[label][point][slice]
  const buckets = new Map<string, Map<string, Map<string, Bucket>>>();
  const curveRows = new Map<string, Map<number, RowError[]>>();
  const bucket = (label: string, point: string, slice: string): Bucket => {
    let byPoint = buckets.get(label);
    if (byPoint === undefined)
      buckets.set(label, (byPoint = new Map<string, Map<string, Bucket>>()));
    let bySlice = byPoint.get(point);
    if (bySlice === undefined) byPoint.set(point, (bySlice = new Map<string, Bucket>()));
    let b = bySlice.get(slice);
    if (b === undefined) bySlice.set(slice, (b = { errors: [], excluded: 0 }));
    return b;
  };

  for (const s of truth) {
    const keys = sliceKeys(s.metadata);
    const idx = s.metadata.index;
    for (const set of sets) {
      const p = set.byIndex.get(idx);
      if (p === undefined)
        throw new Error(`${set.label}: no prediction for scenario ${String(idx)}`);
      const last = p.rows.at(-1);
      if (last === undefined) throw new Error(`${set.label}: empty prediction for ${String(idx)}`);
      const finalErr = rowError(s, last);
      for (const k of keys) bucket(set.label, "final", k).errors.push(finalErr);
      if (p.mode !== "per_timestep") continue;
      const errs = p.rows.map((r) => rowError(s, r));
      for (const sec of opts.points) {
        const e = errs.find((x) => Math.abs(x.t_since_zig_s - sec) < 1e-6);
        for (const k of keys) {
          const b = bucket(set.label, `zig+${String(sec)}s`, k);
          if (e === undefined) b.excluded++;
          else b.errors.push(e);
        }
      }
      let curves = curveRows.get(set.label);
      if (curves === undefined) curveRows.set(set.label, (curves = new Map<number, RowError[]>()));
      for (const e of errs) {
        const step = Math.round(e.t_since_zig_s / opts.curveStep) * opts.curveStep;
        if (Math.abs(e.t_since_zig_s - step) > 1e-6) continue;
        const list = curves.get(step) ?? [];
        list.push(e);
        curves.set(step, list);
      }
    }
  }

  const metrics: MetricsRecord[] = [];
  for (const [label, byPoint] of buckets) {
    for (const [point, bySlice] of byPoint) {
      for (const slice of [...bySlice.keys()].sort(sliceOrder)) {
        const b = bySlice.get(slice);
        if (b !== undefined) metrics.push(record(label, slice, point, b));
      }
    }
  }
  const curves: CurvePoint[] = [];
  for (const [label, bySec] of curveRows) {
    for (const sec of [...bySec.keys()].sort((a, b) => a - b)) {
      const errs = bySec.get(sec) ?? [];
      const rr = ascending(errs.map((e) => e.range_rel));
      curves.push({
        estimator: label,
        t_since_zig_s: sec,
        n: errs.length,
        range_rel_median: median(rr),
        range_rel_p90: percentile(rr, 0.9),
        course_deg_median: median(ascending(errs.map((e) => e.course_deg))),
        speed_kt_median: median(ascending(errs.map((e) => e.speed_kt))),
        gross_error_rate: errs.filter((e) => e.gross).length / errs.length,
      });
    }
  }
  return { metrics, curves };
}

/** "overall" first, then alphabetical. */
function sliceOrder(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "overall") return -1;
  if (b === "overall") return 1;
  return a < b ? -1 : 1;
}
