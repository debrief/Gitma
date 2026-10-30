// G5 (SRD Annex C §C.5; spec 012 FR-005): an end-to-end tracker better than the re-tuned reference
// overall, and at most 10% worse once the target has settled. On the σ = 1° slice, rows at
// zig + 5, 10, 15 and 20 min where the window reaches them, in every scenario:
// - G5-range, G5-course: median error over all G5 rows, tracker / reference, wholly below 1;
// - G5-speed: the same ratio, reported, not gated;
// - G5-settled-range, -course, -speed: the same ratios on settled rows, wholly below 1.1;
// - G5-gross: gross-error rate (range error > 50% or no converged estimate), tracker − reference,
//   reported, not gated.
// Every interval is a scenario-clustered paired bootstrap (a scenario contributes up to four
// rows) at 97.5% per tracker: two trackers get a shot at the gate (Bonferroni). FR-015 per check.
import type {
  GateCheck,
  GateResult,
  GateVerdict,
  PredictionRow,
  Scenario,
  ScenarioMetadata,
} from "@tma/types";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapClusteredQuantileRatio,
  bootstrapClusteredRateDifference,
} from "./bootstrap.js";
import { GROSS_RANGE_REL, rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { judge } from "./gate-g3.js";

export const G5_SLICE_SIGMA_RAD = Math.PI / 180;
/** Gate times after the zig (min). */
export const G5_GATE_MIN = [5, 10, 15, 20] as const;
export const G5_RATIO = 1;
export const G5_SETTLED_RATIO = 1.1;
/** Interval level per tracker (two trackers, Bonferroni). */
export const G5_LEVEL = 0.975;
/** A row is settled this long after the most recent manoeuvre ended (s). */
export const G5_SETTLE_S = 300;

type Metric = "range_rel" | "course_deg" | "speed_kt";

/**
 * Settled (Annex C §C.5): at row k no manoeuvre is in progress (no span has start_index ≤ k <
 * end_index), and either none has started (every start_index > k) or the most recent one ended at
 * least `G5_SETTLE_S` before: (k − end_index) · dt ≥ 300 s. Later manoeuvres do not count: a
 * tracker cannot see them. A scenario without spans (older generators) is settled throughout.
 */
export function settledRow(m: ScenarioMetadata, k: number): boolean {
  const spans = m.manoeuvres ?? [];
  if (spans.some((x) => x.start_index <= k && k < x.end_index)) return false;
  let last = -1;
  for (const x of spans) if (x.end_index <= k) last = Math.max(last, x.end_index);
  if (last < 0) return true;
  return (k - last) * m.parameters.dt_s >= G5_SETTLE_S;
}

export interface G5Row {
  s: Scenario;
  k: number;
  minutes: number;
  settled: boolean;
  /** Scenario number among the G5 scenarios (the bootstrap's cluster). */
  cluster: number;
}

/** The G5 rows of `truth`: σ = 1°, zig + 5/10/15/20 min where reached. */
export function g5Rows(truth: Iterable<Scenario>): G5Row[] {
  const rows: G5Row[] = [];
  let cluster = 0;
  for (const s of truth) {
    const m = s.metadata;
    if (Math.abs(m.parameters.noise_sigma_rad - G5_SLICE_SIGMA_RAD) > 1e-6) continue;
    let any = false;
    for (const minutes of G5_GATE_MIN) {
      const k = m.zig_index + Math.round((minutes * 60) / m.parameters.dt_s);
      if (k >= m.samples) continue;
      rows.push({ s, k, minutes, settled: settledRow(m, k), cluster });
      any = true;
    }
    if (any) cluster++;
  }
  return rows;
}

function rowAt(set: PredictionSet, s: Scenario, k: number): PredictionRow | undefined {
  const p = set.byIndex.get(s.metadata.index);
  if (p === undefined)
    throw new Error(`${set.label}: no prediction for scenario ${String(s.metadata.index)}`);
  const dt = s.metadata.parameters.dt_s;
  return p.rows.find((r) => Math.round(r.timestamp_s / dt) === k);
}

const errorOf = (s: Scenario, r: PredictionRow | undefined, m: Metric): number =>
  r === undefined || !r.converged ? Infinity : rowError(s, r)[m];

/** Clusters renumbered 0, 1, … over a subset of rows. */
function clustersOf(rows: G5Row[]): Int32Array {
  const ids = new Map<number, number>();
  return Int32Array.from(rows, (r) => {
    const c = ids.get(r.cluster);
    if (c !== undefined) return c;
    ids.set(r.cluster, ids.size);
    return ids.size - 1;
  });
}

/** The G5 checks of one tracker against the reference (names prefixed with the tracker's label). */
export function g5Checks(
  truth: Iterable<Scenario>,
  tracker: PredictionSet,
  reference: PredictionSet,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): GateCheck[] {
  const all = g5Rows(truth);
  if (all.length === 0) throw new Error("G5: no σ = 1° rows at zig + 5–20 min");
  const settled = all.filter((r) => r.settled);
  const checks: GateCheck[] = [];
  const ratio = (
    name: string,
    rows: G5Row[],
    metric: Metric,
    limit: number,
    gated: boolean,
    what: string,
  ): void => {
    const a = Float64Array.from(rows, (r) => errorOf(r.s, rowAt(tracker, r.s, r.k), metric));
    const b = Float64Array.from(rows, (r) => errorOf(r.s, rowAt(reference, r.s, r.k), metric));
    const x = bootstrapClusteredQuantileRatio(
      a,
      b,
      clustersOf(rows),
      0.5,
      G5_LEVEL,
      resamples,
      seed,
    );
    checks.push({
      name: `${tracker.label}:${name}`,
      result: judge(x.ratio, x.lo, x.hi, limit),
      value: x.ratio,
      threshold: limit,
      ci_low: x.lo,
      ci_high: x.hi,
      ci_level: G5_LEVEL,
      detail: `${gated ? "" : "reported, not gated: "}${tracker.label} / ${reference.label} median ${metric} on ${what} ${x.ratio.toFixed(4)} vs limit ${String(limit)}; ${String(G5_LEVEL * 100)}% CI [${x.lo.toFixed(4)}, ${x.hi.toFixed(4)}] (scenario-clustered paired bootstrap, ${String(x.resamples)} resamples, ${String(x.n)} rows in ${String(x.clusters)} scenarios)`,
    });
  };
  const where = "σ = 1° rows at zig + 5/10/15/20 min";
  ratio("g5-range", all, "range_rel", G5_RATIO, true, where);
  ratio("g5-course", all, "course_deg", G5_RATIO, true, where);
  ratio("g5-speed-reported", all, "speed_kt", G5_RATIO, false, where);
  if (settled.length === 0) throw new Error("G5: no settled rows");
  const sw = `settled ${where}`;
  ratio("g5-settled-range", settled, "range_rel", G5_SETTLED_RATIO, true, sw);
  ratio("g5-settled-course", settled, "course_deg", G5_SETTLED_RATIO, true, sw);
  ratio("g5-settled-speed", settled, "speed_kt", G5_SETTLED_RATIO, true, sw);
  const gross = (set: PredictionSet): Uint8Array =>
    Uint8Array.from(all, (r) =>
      errorOf(r.s, rowAt(set, r.s, r.k), "range_rel") <= GROSS_RANGE_REL ? 0 : 1,
    );
  const ga = gross(tracker);
  const gb = gross(reference);
  const d = bootstrapClusteredRateDifference(ga, gb, clustersOf(all), G5_LEVEL, resamples, seed);
  const rate = (g: Uint8Array): number => g.reduce((t, x) => t + x, 0) / g.length;
  checks.push({
    name: `${tracker.label}:g5-gross-reported`,
    result: d.hi <= 0 ? "pass" : d.lo > 0 ? "fail" : "inconclusive",
    value: d.difference,
    threshold: 0,
    ci_low: d.lo,
    ci_high: d.hi,
    ci_level: G5_LEVEL,
    detail: `reported, not gated: gross-error rate (range error > ${String(GROSS_RANGE_REL * 100)}% or no converged estimate) ${tracker.label} ${(rate(ga) * 100).toFixed(3)}% vs ${reference.label} ${(rate(gb) * 100).toFixed(3)}% on ${where}; difference ${(d.difference * 100).toFixed(3)} pp, ${String(G5_LEVEL * 100)}% CI [${(d.lo * 100).toFixed(3)}, ${(d.hi * 100).toFixed(3)}] pp`,
  });
  return checks;
}

const GATED = [
  "g5-range",
  "g5-course",
  "g5-settled-range",
  "g5-settled-course",
  "g5-settled-speed",
];

/** One tracker's result: pass if every gated check passes, fail if any fails, else inconclusive. */
export function trackerResult(checks: GateCheck[], label: string): GateResult {
  const gated = checks.filter((c) => GATED.some((g) => c.name === `${label}:${g}`));
  if (gated.length !== GATED.length) throw new Error(`G5: ${label} lacks gated checks`);
  if (gated.some((c) => c.result === "fail")) return "fail";
  return gated.every((c) => c.result === "pass") ? "pass" : "inconclusive";
}

/**
 * The G5 verdict over one or two trackers: pass if any tracker passes; fail if every tracker
 * fails; otherwise inconclusive (Annex C §C.5).
 */
export function g5Verdict(checks: GateCheck[], labels: string[]): GateVerdict {
  const results = labels.map((l) => trackerResult(checks, l));
  const result: GateResult = results.includes("pass")
    ? "pass"
    : results.every((r) => r === "fail")
      ? "fail"
      : "inconclusive";
  return { gate: "G5", result, checks, decided_by: "harness (pending agent panel review)" };
}
