// Gate G7 (spec 018; SRD Annex C §C.13): calibrated uncertainty. On G5's rows (σ = 1°, zig + 5,
// 10, 15 and 20 min), each estimator's normalised error per output is
//   z = |e| / sd,
// with e the log-range error ln(r̂ / r), the wrapped course error, or the speed error, and sd its
// stated standard deviation (`log_range_sd`, `course_sd_rad`, `speed_sd_mps`). A row with no
// converged estimate or no stated sd has z = +∞: it is never covered, and its width is +∞.
//
// - Recalibration (post hoc, fitted on validation): the q-interval is ± m_q · sd, with m_q the
//   q-quantile of z (q = 0.5 and 0.9).
// - Coverage: the share of rows with z ≤ m_q.
// - Width: 2 · m_90 · sd, in log units, degrees or knots.
import type {
  GateCheck,
  GateResult,
  GateVerdict,
  PredictionRow,
  Scenario,
  UncertaintyCalibration,
} from "@tma/types";
import { angleDiff } from "@tma/sim";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapClusteredQuantileRatio,
  bootstrapClusteredRateDifference,
  selectQuantile,
} from "./bootstrap.js";
import type { PredictionSet } from "./evaluate.js";
import { g5Rows } from "./gate-g5.js";

export const G7_OUTPUTS = ["log_range", "course", "speed"] as const;
export type G7Output = (typeof G7_OUTPUTS)[number];
/** Tolerance on coverage (absolute, either side of nominal). */
export const G7_COVERAGE_TOLERANCE = 0.02;
/** Interval level: one tracker is judged. */
export const G7_LEVEL = 0.95;
const KT = 3600 / 1852;
const DEG = 180 / Math.PI;

/** The truth at row k of scenario s: range, course and speed. */
function truthAt(s: Scenario, k: number): { range: number; course: number; speed: number } {
  const t = s.target.states[k];
  const o = s.ownship.states[k];
  if (t === undefined || o === undefined)
    throw new Error(`scenario ${String(s.metadata.index)}: no state at ${String(k)}`);
  return {
    range: Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m),
    course: t.course_rad,
    speed: t.speed_mps,
  };
}

/**
 * One G5 row as G7 needs it: the scenario's index and dt, the row's sample, its cluster (G5's
 * numbering) and the truth there. Compact, so a large split can be streamed (spec 018 re-score).
 */
export interface G7Row {
  index: number;
  k: number;
  dt: number;
  cluster: number;
  range: number;
  course: number;
  speed: number;
}

/** G5's rows of `truth` (σ = 1°, zig + 5/10/15/20 min) as compact G7 rows, one scenario at a time. */
export function g7Rows(truth: Iterable<Scenario>): G7Row[] {
  const out: G7Row[] = [];
  let cluster = 0;
  for (const s of truth) {
    const rows = g5Rows([s]);
    if (rows.length === 0) continue;
    for (const r of rows)
      out.push({
        index: s.metadata.index,
        k: r.k,
        dt: s.metadata.parameters.dt_s,
        cluster,
        ...truthAt(s, r.k),
      });
    cluster++;
  }
  return out;
}

function rowAt(set: PredictionSet, r: G7Row): PredictionRow | undefined {
  const p = set.byIndex.get(r.index);
  if (p === undefined)
    throw new Error(`${set.label}: no prediction for scenario ${String(r.index)}`);
  return p.rows.find((x) => Math.round(x.timestamp_s / r.dt) === r.k);
}

/** Signed error and stated sd of one output against truth `t`; null without an estimate or sd. */
function errorAndSdAt(
  t: { range: number; course: number; speed: number },
  r: PredictionRow | undefined,
  out: G7Output,
): { e: number; sd: number } | null {
  if (r === undefined || !r.converged) return null;
  const sd =
    out === "log_range" ? r.log_range_sd : out === "course" ? r.course_sd_rad : r.speed_sd_mps;
  if (sd == null || !(sd > 0) || !Number.isFinite(sd)) return null;
  const e =
    out === "log_range"
      ? Math.log(r.range_m / t.range)
      : out === "course"
        ? angleDiff(r.course_rad, t.course)
        : r.speed_mps - t.speed;
  return Number.isFinite(e) ? { e, sd } : null;
}

/** Signed error and stated sd of one output at row k of `s`; null when there is no estimate or sd. */
export function errorAndSd(
  s: Scenario,
  k: number,
  r: PredictionRow | undefined,
  out: G7Output,
): { e: number; sd: number } | null {
  return errorAndSdAt(truthAt(s, k), r, out);
}

/** z = |e| / sd per row (+∞ without an estimate or a stated sd). */
export function normalisedErrors(
  rows: readonly G7Row[],
  set: PredictionSet,
  out: G7Output,
): Float64Array {
  return Float64Array.from(rows, (r) => {
    const x = errorAndSdAt(r, rowAt(set, r), out);
    return x === null ? Infinity : Math.abs(x.e) / x.sd;
  });
}

/** 90% widths 2 · m90 · sd per row, in log units, degrees or knots (+∞ without an estimate). */
export function widths(
  rows: readonly G7Row[],
  set: PredictionSet,
  out: G7Output,
  m90: number,
): Float64Array {
  const unit = out === "course" ? DEG : out === "speed" ? KT : 1;
  return Float64Array.from(rows, (r) => {
    const x = errorAndSdAt(r, rowAt(set, r), out);
    return x === null ? Infinity : 2 * m90 * x.sd * unit;
  });
}

/** The 50% and 90% multipliers of `set` on `rows`, per output. */
export function fitCalibration(
  rows: readonly G7Row[],
  set: PredictionSet,
): UncertaintyCalibration[] {
  return G7_OUTPUTS.map((output) => {
    const z = normalisedErrors(rows, set, output);
    return {
      estimator: set.estimator,
      output,
      q50: selectQuantile(Float64Array.from(z), 0.5),
      q90: selectQuantile(Float64Array.from(z), 0.9),
    };
  });
}

function clustersOf(rows: readonly G7Row[]): Int32Array {
  const ids = new Map<number, number>();
  return Int32Array.from(rows, (r) => {
    const c = ids.get(r.cluster);
    if (c !== undefined) return c;
    ids.set(r.cluster, ids.size);
    return ids.size - 1;
  });
}

const calOf = (
  cal: readonly UncertaintyCalibration[],
  estimator: string,
  output: G7Output,
): UncertaintyCalibration => {
  const c = cal.find((x) => x.estimator === estimator && x.output === output);
  if (c === undefined) throw new Error(`no calibration for ${estimator} ${output}`);
  return c;
};

/** Coverage checks of one set (gated or reported) at its multipliers. */
function coverageChecks(
  rows: readonly G7Row[],
  cl: Int32Array,
  set: PredictionSet,
  cal: readonly UncertaintyCalibration[],
  gated: boolean,
  resamples: number,
  seed: bigint,
): GateCheck[] {
  const out: GateCheck[] = [];
  for (const output of G7_OUTPUTS) {
    const c = calOf(cal, set.estimator, output);
    const z = normalisedErrors(rows, set, output);
    for (const [q, m] of [
      [0.5, c.q50],
      [0.9, c.q90],
    ] as const) {
      const hit = Uint8Array.from(z, (v) => (v <= m ? 1 : 0));
      const r = bootstrapClusteredRateDifference(
        hit,
        new Uint8Array(hit.length),
        cl,
        G7_LEVEL,
        resamples,
        seed,
      );
      const lo = q - G7_COVERAGE_TOLERANCE;
      const hi = q + G7_COVERAGE_TOLERANCE;
      const result: GateResult =
        r.lo >= lo && r.hi <= hi ? "pass" : r.hi < lo || r.lo > hi ? "fail" : "inconclusive";
      out.push({
        name: `${set.label}:g7-coverage-${output}-${String(q * 100)}${gated ? "" : "-reported"}`,
        result,
        value: r.difference,
        threshold: q,
        ci_low: r.lo,
        ci_high: r.hi,
        ci_level: G7_LEVEL,
        detail: `${gated ? "" : "reported, not gated: "}${set.label} ${output} ${String(q * 100)}% interval (± ${m.toPrecision(5)} × stated sd) covers ${(r.difference * 100).toFixed(2)}% of ${String(rows.length)} G5 rows; ${String(G7_LEVEL * 100)}% CI [${(r.lo * 100).toFixed(2)}, ${(r.hi * 100).toFixed(2)}]%, required within ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`,
      });
    }
  }
  return out;
}

/**
 * The G7 checks of `tracker` against `reference`, at the multipliers in `cal`:
 * - g7-coverage-<output>-<50|90>: the tracker's coverage interval within nominal ± 2 pp (gated);
 *   the reference's the same, reported;
 * - g7-width-<output>: median 90% width tracker / reference, wholly below 1 (gated).
 */
export function g7Checks(
  rows: readonly G7Row[],
  tracker: PredictionSet,
  reference: PredictionSet,
  cal: readonly UncertaintyCalibration[],
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): GateCheck[] {
  if (rows.length === 0) throw new Error("G7: no σ = 1° rows at zig + 5–20 min");
  const cl = clustersOf(rows);
  const checks = coverageChecks(rows, cl, tracker, cal, true, resamples, seed);
  for (const output of G7_OUTPUTS) {
    const a = widths(rows, tracker, output, calOf(cal, tracker.estimator, output).q90);
    const b = widths(rows, reference, output, calOf(cal, reference.estimator, output).q90);
    const x = bootstrapClusteredQuantileRatio(a, b, cl, 0.5, G7_LEVEL, resamples, seed);
    const finite = Number.isFinite(x.ratio) && Number.isFinite(x.lo) && Number.isFinite(x.hi);
    checks.push({
      name: `${tracker.label}:g7-width-${output}`,
      result: !finite
        ? "inconclusive"
        : x.ratio < 1 && x.hi < 1
          ? "pass"
          : x.lo >= 1
            ? "fail"
            : "inconclusive",
      threshold: 1,
      ci_level: G7_LEVEL,
      ...(finite ? { value: x.ratio, ci_low: x.lo, ci_high: x.hi } : {}),
      detail: `${tracker.label} / ${reference.label} median calibrated 90% width of ${output} on ${String(rows.length)} G5 rows in ${String(x.clusters)} scenarios ${finite ? `${x.ratio.toFixed(4)}; ${String(G7_LEVEL * 100)}% CI [${x.lo.toFixed(4)}, ${x.hi.toFixed(4)}]` : "undefined (a median width is +∞)"}, limit 1`,
    });
  }
  checks.push(...coverageChecks(rows, cl, reference, cal, false, resamples, seed));
  return checks;
}

/** G7: pass if every gated check passes, fail if any gated check fails, otherwise inconclusive. */
export function g7Verdict(checks: GateCheck[]): GateVerdict {
  const gated = checks.filter((c) => !c.name.endsWith("-reported"));
  const result: GateResult = gated.every((c) => c.result === "pass")
    ? "pass"
    : gated.some((c) => c.result === "fail")
      ? "fail"
      : "inconclusive";
  return { gate: "G7", result, checks, decided_by: "machine verdict (pending agent review panel)" };
}
