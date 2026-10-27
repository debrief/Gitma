// G3 (SRD §5): classical parity, "within 1.2× classical on every metric, and lower gross-error
// rate". Spec 009 judges it for the hybrid estimator against classical on the same scenarios:
// - every metric: the median and the 90th percentile of range and course error five minutes
//   after the zig, and of speed error ten minutes after it (G2's points), each as a paired
//   bootstrap 95% interval of hybrid / classical, against 1.2;
// - lower gross-error rate: the paired bootstrap 95% interval of the difference in gross-error
//   rate (range error > 50%, or no converged estimate), hybrid − classical, five minutes after
//   the zig, against 0.
// On the σ = 1° slice. Each check follows FR-015: pass needs the point and the whole interval
// below the limit; fail needs the interval's lower bound at or above it; otherwise inconclusive.
import type { GateCheck, GateResult, GateVerdict, Scenario } from "@tma/types";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapQuantileRatio,
  bootstrapRateDifference,
  pairedErrors,
} from "./bootstrap.js";
import { GROSS_RANGE_REL } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { sliceKeys } from "./slices.js";

/** SRD §5: within this multiple of classical on every metric. */
export const G3_RATIO = 1.2;
export const G3_SLICE = "sigma=1deg";

export interface G3Criterion {
  name: string;
  metric: "range_rel" | "course_deg" | "speed_kt";
  /** 0.5 (median) or 0.9 (90th percentile). */
  quantile: number;
  seconds: number;
}

/** The six metric checks: median and P90 of range and course at zig + 300 s, speed at + 600 s. */
export const G3_CRITERIA: readonly G3Criterion[] = [
  { name: "range-median", metric: "range_rel", quantile: 0.5, seconds: 300 },
  { name: "range-p90", metric: "range_rel", quantile: 0.9, seconds: 300 },
  { name: "course-median", metric: "course_deg", quantile: 0.5, seconds: 300 },
  { name: "course-p90", metric: "course_deg", quantile: 0.9, seconds: 300 },
  { name: "speed-median", metric: "speed_kt", quantile: 0.5, seconds: 600 },
  { name: "speed-p90", metric: "speed_kt", quantile: 0.9, seconds: 600 },
];
/** The gross-error check's point, seconds after the zig. */
export const G3_GROSS_SECONDS = 300;

/** FR-015 against a limit: pass below it, fail at or above it, otherwise inconclusive. */
export function judge(value: number, lo: number, hi: number, limit: number): GateResult {
  if (value < limit && hi < limit) return "pass";
  if (lo >= limit) return "fail";
  return "inconclusive";
}

/** The scenarios of `slice`, as a re-iterable. */
export const inSlice = (truth: Iterable<Scenario>, slice: string): Iterable<Scenario> => ({
  *[Symbol.iterator]() {
    for (const s of truth) if (sliceKeys(s.metadata).includes(slice)) yield s;
  },
});

const pct = (q: number): string => (q === 0.5 ? "median" : `P${String(q * 100)}`);

/** The seven G3 checks of `hybrid` against `classical` (spec 009 FR-007). */
export function g3Checks(
  truth: Iterable<Scenario>,
  hybrid: PredictionSet,
  classical: PredictionSet,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
  slice = G3_SLICE,
): GateCheck[] {
  const rows = inSlice(truth, slice);
  const checks: GateCheck[] = [];
  const paired = (seconds: number, metric: G3Criterion["metric"]) => {
    const p = pairedErrors(rows, hybrid, classical, seconds, metric);
    if (p.a.length === 0) throw new Error(`G3: no ${slice} rows at zig+${String(seconds)}s`);
    return p;
  };
  for (const c of G3_CRITERIA) {
    const { a, b } = paired(c.seconds, c.metric);
    const r = bootstrapQuantileRatio(a, b, c.quantile, resamples, seed);
    checks.push({
      name: `g3-${c.name}`,
      result: judge(r.ratio, r.lo, r.hi, G3_RATIO),
      value: r.ratio,
      threshold: G3_RATIO,
      ci_low: r.lo,
      ci_high: r.hi,
      ci_level: 0.95,
      detail: `${hybrid.label} / ${classical.label} ${pct(c.quantile)} ${c.metric} ${r.ratio.toFixed(4)} vs limit ${String(G3_RATIO)} on ${slice} at zig+${String(c.seconds)}s; 95% CI [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}] (paired bootstrap, ${String(r.resamples)} resamples, n ${String(r.n)})`,
    });
  }
  const { a, b } = paired(G3_GROSS_SECONDS, "range_rel");
  const ga = Uint8Array.from(a, (x) => (x <= GROSS_RANGE_REL ? 0 : 1));
  const gb = Uint8Array.from(b, (x) => (x <= GROSS_RANGE_REL ? 0 : 1));
  const d = bootstrapRateDifference(ga, gb, resamples, seed);
  const rate = (g: Uint8Array): number => g.reduce((s, x) => s + x, 0) / g.length;
  checks.push({
    name: "g3-gross-error-rate",
    result: judge(d.difference, d.lo, d.hi, 0),
    value: d.difference,
    threshold: 0,
    ci_low: d.lo,
    ci_high: d.hi,
    ci_level: 0.95,
    detail: `gross-error rate (range error > ${String(GROSS_RANGE_REL * 100)}% or no converged estimate) ${hybrid.label} ${(rate(ga) * 100).toFixed(3)}% vs ${classical.label} ${(rate(gb) * 100).toFixed(3)}% on ${slice} at zig+${String(G3_GROSS_SECONDS)}s; difference ${(d.difference * 100).toFixed(3)} pp, 95% CI [${(d.lo * 100).toFixed(3)}, ${(d.hi * 100).toFixed(3)}] pp (paired bootstrap, ${String(d.resamples)} resamples, n ${String(d.n)})`,
  });
  return checks;
}

/** Pass when every check passes, fail when any fails, otherwise inconclusive. */
export function g3Verdict(checks: GateCheck[]): GateVerdict {
  const result: GateResult = checks.some((c) => c.result === "fail")
    ? "fail"
    : checks.every((c) => c.result === "pass")
      ? "pass"
      : "inconclusive";
  return { gate: "G3", result, checks, decided_by: "harness (pending agent panel review)" };
}
