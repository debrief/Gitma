// Gate G6 (spec 017; SRD Annex C §C.12): a manoeuvre detector built from frozen models against a
// CUSUM on the reference IMM's innovations, at matched false-alarm rates. Pure functions over
// scenarios and per-timestep scores.
//
// - Rows: σ = 1° scenarios, rows from zig_index + 1 (the trackers' rows).
// - Events: each target course change whose start_index is a row. Its window runs from
//   start_index for `EVENT_WINDOW_S` (10 min), cut at the next manoeuvre's start and the
//   scenario's end. The event is detected at the first row in its window whose score is at or
//   above the threshold. It must be "armed": the row before start_index, if it is a row, is
//   below the threshold (an alarm still standing from earlier counts for nothing). Delay =
//   (row − start_index) · dt; a miss or a masked event has delay +∞.
// - False alarms: alarm onsets (score ≥ threshold, previous row below it, or the first row) on
//   quiet rows. Quiet rows are settled rows (G5's definition: no manoeuvre in progress, and none
//   ended in the last 5 min). The rate is onsets per hour of quiet rows.
// - Thresholds: each detector's is set on validation so that its false-alarm rate equals the
//   target (`calibrateThreshold`), and frozen in the decision.
import type { GateCheck, GateResult, GateVerdict, Scenario } from "@tma/types";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapClusteredQuantileRatio,
  bootstrapClusteredRateDifference,
} from "./bootstrap.js";
import { createRng, uniformInt } from "@tma/sim";
import { G5_SLICE_SIGMA_RAD, settledRow } from "./gate-g5.js";

/** An event's detection window after its start (s). */
export const EVENT_WINDOW_S = 600;
/** "Detected in time" (s after the manoeuvre starts). */
export const DETECT_WITHIN_S = 300;
/** Target false-alarm rate on quiet rows (alarms per hour), the matched operating point. */
export const G6_FA_PER_HOUR = 0.5;
/** Non-inferiority margin on the detected-within-5-min rate (learned − CUSUM). */
export const G6_DETECT_MARGIN = -0.02;
/** Largest test false-alarm ratio (learned / CUSUM) the gate allows. */
export const G6_FA_RATIO = 1.25;
/** Interval level: one detector is judged. */
export const G6_LEVEL = 0.95;

/** Scores of one detector, by scenario index, at the rows' timestamps. */
export type Scores = Map<number, { t: Float64Array; score: Float32Array }>;

/** One course-change event of a σ = 1° scenario. */
export interface G6Event {
  s: Scenario;
  start: number;
  end: number;
  cluster: number;
}

/** The σ = 1° scenarios, numbered as clusters, with their course-change events. */
export function g6Events(truth: Iterable<Scenario>): {
  events: G6Event[];
  scenarios: { s: Scenario; cluster: number }[];
} {
  const events: G6Event[] = [];
  const scenarios: { s: Scenario; cluster: number }[] = [];
  for (const s of truth) {
    const m = s.metadata;
    if (Math.abs(m.parameters.noise_sigma_rad - G5_SLICE_SIGMA_RAD) > 1e-6) continue;
    const cluster = scenarios.length;
    scenarios.push({ s, cluster });
    const spans = [...(m.manoeuvres ?? [])].sort((a, b) => a.start_index - b.start_index);
    const win = Math.round(EVENT_WINDOW_S / m.parameters.dt_s);
    spans.forEach((x, j) => {
      if (x.kind !== "course" || x.start_index <= m.zig_index || x.start_index >= m.samples) return;
      const next = spans[j + 1]?.start_index ?? Infinity;
      events.push({
        s,
        start: x.start_index,
        end: Math.min(x.start_index + win, next, m.samples),
        cluster,
      });
    });
  }
  return { events, scenarios };
}

/** Scores of scenario `s` by sample index (NaN where there is no row). */
function scoresBySample(scores: Scores, s: Scenario): Float64Array {
  const d = scores.get(s.metadata.index);
  if (d === undefined)
    throw new Error(`no detection scores for scenario ${String(s.metadata.index)}`);
  const out = new Float64Array(s.metadata.samples).fill(NaN);
  const dt = s.metadata.parameters.dt_s;
  d.t.forEach((t, j) => {
    const k = Math.round(t / dt);
    if (k >= 0 && k < out.length) out[k] = d.score[j] ?? NaN;
  });
  return out;
}

/** An event's detection delay (s) at threshold h, +∞ if missed or masked. */
export function eventDelay(e: G6Event, byS: Float64Array, h: number): number {
  const before = byS[e.start - 1];
  if (before !== undefined && !Number.isNaN(before) && before >= h) return Infinity;
  for (let k = e.start; k < e.end; k++) {
    const v = byS[k];
    if (v !== undefined && v >= h) return (k - e.start) * e.s.metadata.parameters.dt_s;
  }
  return Infinity;
}

/** Alarm onsets on quiet rows and the quiet hours of one scenario at threshold h. */
export function falseAlarms(
  s: Scenario,
  byS: Float64Array,
  h: number,
): { onsets: number; hours: number } {
  const m = s.metadata;
  let onsets = 0;
  let quiet = 0;
  let prev = -Infinity;
  for (let k = m.zig_index + 1; k < m.samples; k++) {
    const v = byS[k];
    if (v === undefined || Number.isNaN(v)) {
      prev = -Infinity;
      continue;
    }
    if (settledRow(m, k)) {
      quiet++;
      if (v >= h && prev < h) onsets++;
    }
    prev = v;
  }
  return { onsets, hours: (quiet * m.parameters.dt_s) / 3600 };
}

/** Pooled false-alarm rate (per hour of quiet rows) of `scores` at h over `scenarios`. */
export function falseAlarmRate(scenarios: { s: Scenario }[], scores: Scores, h: number): number {
  let n = 0;
  let hours = 0;
  for (const { s } of scenarios) {
    const f = falseAlarms(s, scoresBySample(scores, s), h);
    n += f.onsets;
    hours += f.hours;
  }
  return hours > 0 ? n / hours : 0;
}

/**
 * The smallest threshold (to 1e-6 relative) whose pooled false-alarm rate is at most `target`, by
 * bisection; the rate falls (weakly) as the threshold rises.
 */
export function calibrateThreshold(
  scenarios: { s: Scenario }[],
  scores: Scores,
  target = G6_FA_PER_HOUR,
): { threshold: number; rate: number } {
  const bySample = scenarios.map(({ s }) => ({ s, b: scoresBySample(scores, s) }));
  const rateAt = (h: number): number => {
    let n = 0;
    let hours = 0;
    for (const { s, b } of bySample) {
      const f = falseAlarms(s, b, h);
      n += f.onsets;
      hours += f.hours;
    }
    return hours > 0 ? n / hours : 0;
  };
  let hi = 1;
  for (const { b } of bySample) for (const v of b) if (v > hi) hi = v;
  hi *= 1.0001;
  let lo = 0;
  if (rateAt(lo) <= target) return { threshold: lo, rate: rateAt(lo) };
  for (let i = 0; i < 80 && hi - lo > 1e-6 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (rateAt(mid) <= target) hi = mid;
    else lo = mid;
  }
  return { threshold: hi, rate: rateAt(hi) };
}

/** Per-event delays and per-scenario false alarms of one detector at threshold h. */
export function detectorOutcome(
  events: G6Event[],
  scenarios: { s: Scenario; cluster: number }[],
  scores: Scores,
  h: number,
): { delays: Float64Array; onsets: Float64Array; hours: Float64Array } {
  const cache = new Map<number, Float64Array>();
  const by = (s: Scenario): Float64Array => {
    let b = cache.get(s.metadata.index);
    if (b === undefined) {
      b = scoresBySample(scores, s);
      cache.set(s.metadata.index, b);
    }
    return b;
  };
  const delays = Float64Array.from(events, (e) => eventDelay(e, by(e.s), h));
  const fa = scenarios.map(({ s }) => falseAlarms(s, by(s), h));
  return {
    delays,
    onsets: Float64Array.from(fa, (f) => f.onsets),
    hours: Float64Array.from(fa, (f) => f.hours),
  };
}

/** Scenario-clustered paired bootstrap of the ratio of two counts' sums (false alarms). */
export function bootstrapSumRatio(
  a: Float64Array,
  b: Float64Array,
  level: number,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): { ratio: number; lo: number; hi: number } {
  const n = a.length;
  if (n === 0 || b.length !== n) throw new Error("bootstrap needs two equal, non-empty samples");
  const rng = createRng(seed);
  const ratios: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sa = 0;
    let sb = 0;
    for (let j = 0; j < n; j++) {
      const i = uniformInt(rng, n);
      sa += a[i] ?? 0;
      sb += b[i] ?? 0;
    }
    ratios.push(sb > 0 ? sa / sb : sa > 0 ? Infinity : 1);
  }
  ratios.sort((x, y) => x - y);
  const at = (q: number): number =>
    ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))] ?? NaN;
  const tail = (1 - level) / 2;
  const sa = a.reduce((t, x) => t + x, 0);
  const sb = b.reduce((t, x) => t + x, 0);
  return { ratio: sb > 0 ? sa / sb : Infinity, lo: at(tail), hi: at(1 - tail) };
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/**
 * The G6 checks of `learned` against `cusum`, each at its frozen threshold:
 * - g6-delay: median detection delay ratio learned / CUSUM over course-change events (misses
 *   +∞), wholly below 1;
 * - g6-detect5: detected-within-5-min rate difference learned − CUSUM, lower bound ≥ −2 pp;
 * - g6-false-alarms: false-alarm ratio learned / CUSUM on quiet rows, upper bound ≤ 1.25.
 */
export function g6Checks(
  truth: Iterable<Scenario>,
  learned: { label: string; scores: Scores; threshold: number },
  cusum: { label: string; scores: Scores; threshold: number },
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): GateCheck[] {
  const { events, scenarios } = g6Events(truth);
  if (events.length === 0) throw new Error("G6: no σ = 1° course-change events");
  const a = detectorOutcome(events, scenarios, learned.scores, learned.threshold);
  const b = detectorOutcome(events, scenarios, cusum.scores, cusum.threshold);
  const clusters = Int32Array.from(events, (e) => e.cluster);
  const remap = new Map<number, number>();
  const cl = Int32Array.from(clusters, (c) => {
    const v = remap.get(c);
    if (v !== undefined) return v;
    remap.set(c, remap.size);
    return remap.size - 1;
  });
  const checks: GateCheck[] = [];
  const d = bootstrapClusteredQuantileRatio(a.delays, b.delays, cl, 0.5, G6_LEVEL, resamples, seed);
  // Both medians infinite (each detector misses at least half the events): the ratio is
  // undefined, so the check cannot be judged either way (spec 017 R2).
  const undefinedRatio = !Number.isFinite(d.ratio) || !Number.isFinite(d.lo);
  const delayResult: GateResult = undefinedRatio
    ? "inconclusive"
    : d.ratio < 1 && d.hi < 1
      ? "pass"
      : d.lo >= 1
        ? "fail"
        : "inconclusive";
  checks.push({
    name: `${learned.label}:g6-delay`,
    result: delayResult,
    threshold: 1,
    ci_level: G6_LEVEL,
    ...(undefinedRatio ? {} : { value: d.ratio, ci_low: d.lo, ci_high: d.hi }),
    detail: undefinedRatio
      ? `${learned.label} / ${cusum.label} median detection delay over ${String(events.length)} course-change events in ${String(d.clusters)} scenarios is undefined: at these thresholds at least one detector misses half the events or more (median +∞)`
      : `${learned.label} / ${cusum.label} median detection delay over ${String(events.length)} course-change events in ${String(d.clusters)} scenarios (misses +∞) ${d.ratio.toFixed(4)} vs limit 1; ${String(G6_LEVEL * 100)}% CI [${d.lo.toFixed(4)}, ${d.hi.toFixed(4)}]`,
  });
  const within = (x: Float64Array): Uint8Array =>
    Uint8Array.from(x, (v) => (v <= DETECT_WITHIN_S ? 1 : 0));
  const wa = within(a.delays);
  const wb = within(b.delays);
  const r = bootstrapClusteredRateDifference(wa, wb, cl, G6_LEVEL, resamples, seed);
  const rate = (w: Uint8Array): number => w.reduce((t, x) => t + x, 0) / w.length;
  checks.push({
    name: `${learned.label}:g6-detect5`,
    result: r.lo >= G6_DETECT_MARGIN ? "pass" : r.hi < G6_DETECT_MARGIN ? "fail" : "inconclusive",
    value: r.difference,
    threshold: G6_DETECT_MARGIN,
    ci_low: r.lo,
    ci_high: r.hi,
    ci_level: G6_LEVEL,
    detail: `detected within ${String(DETECT_WITHIN_S)} s: ${learned.label} ${pct(rate(wa))} vs ${cusum.label} ${pct(rate(wb))}; difference ${(r.difference * 100).toFixed(2)} pp, ${String(G6_LEVEL * 100)}% CI [${(r.lo * 100).toFixed(2)}, ${(r.hi * 100).toFixed(2)}] pp, margin ${String(G6_DETECT_MARGIN * 100)} pp`,
  });
  const f = bootstrapSumRatio(a.onsets, b.onsets, G6_LEVEL, resamples, seed);
  const hours = a.hours.reduce((t, x) => t + x, 0);
  const sum = (x: Float64Array): number => x.reduce((t, v) => t + v, 0);
  checks.push({
    name: `${learned.label}:g6-false-alarms`,
    result: f.hi <= G6_FA_RATIO ? "pass" : f.lo > G6_FA_RATIO ? "fail" : "inconclusive",
    value: f.ratio,
    threshold: G6_FA_RATIO,
    ci_low: f.lo,
    ci_high: f.hi,
    ci_level: G6_LEVEL,
    detail: `false alarms on ${hours.toFixed(1)} quiet hours: ${learned.label} ${(sum(a.onsets) / hours).toFixed(3)}/h vs ${cusum.label} ${(sum(b.onsets) / hours).toFixed(3)}/h (thresholds ${learned.threshold.toPrecision(6)} and ${cusum.threshold.toPrecision(6)}, set on validation for ${String(G6_FA_PER_HOUR)}/h); ratio ${f.ratio.toFixed(4)}, ${String(G6_LEVEL * 100)}% CI [${f.lo.toFixed(4)}, ${f.hi.toFixed(4)}], limit ${String(G6_FA_RATIO)}`,
  });
  return checks;
}

/** G6: pass if all three checks pass, fail if any fails, otherwise inconclusive. */
export function g6Verdict(checks: GateCheck[]): GateVerdict {
  const result: GateResult = checks.every((c) => c.result === "pass")
    ? "pass"
    : checks.some((c) => c.result === "fail")
      ? "fail"
      : "inconclusive";
  return { gate: "G6", result, checks, decided_by: "machine verdict (pending agent review panel)" };
}
