// G4 (SRD Annex B §B.4; spec 010 FR-008, FR-011): better than the tuned tracker after a turn.
// On the σ = 1° slice, turning scenarios only, five minutes after the target's turn ends
// (manoeuvre_index + 300 s; rows before it are never scored, whatever their slice):
// - G4-range, G4-course: paired bootstrap 95% interval of median error, network / reference,
//   wholly below 1;
// - G4-speed: the same ratio, reported, not gated (speed does not change at the turn);
// - G4-gross: gross-error rate (range error > 50% or no converged estimate), network −
//   reference, wholly at or below 0 (Annex B wording);
// - G4-control: the network on the held-course scenarios, G2's three checks (range and course at
//   zig + 300 s, speed at zig + 600 s) against G2's thresholds, each with a bootstrap interval.
// The reference is the frozen tracker the decision record names: the better of the tuned EKF and
// the tuned IMM on validation (owner decision 2026-10-28). FR-015 for each check.
import type { GateCheck, GateResult, GateVerdict, PredictionRow, Scenario } from "@tma/types";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapMedian,
  bootstrapQuantileRatio,
  bootstrapRateDifference,
} from "./bootstrap.js";
import { GROSS_RANGE_REL, rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { judge } from "./gate-g3.js";
import { G2_CRITERIA } from "./gate-g2.js";

export const G4_SLICE_SIGMA_RAD = Math.PI / 180;
/** Seconds after `manoeuvre_index` at which G4 is judged. */
export const G4_SECONDS = 300;
export const G4_RATIO = 1;

type Metric = "range_rel" | "course_deg" | "speed_kt";

const isSigma1 = (s: Scenario): boolean =>
  Math.abs(s.metadata.parameters.noise_sigma_rad - G4_SLICE_SIGMA_RAD) < 1e-6;

/** The row of `set` for scenario `s` at sample `k`, if any. */
function rowAt(set: PredictionSet, s: Scenario, k: number): PredictionRow | undefined {
  const p = set.byIndex.get(s.metadata.index);
  if (p === undefined)
    throw new Error(`${set.label}: no prediction for scenario ${String(s.metadata.index)}`);
  const dt = s.metadata.parameters.dt_s;
  return p.rows.find((r) => Math.round(r.timestamp_s / dt) === k);
}

const errorOf = (s: Scenario, r: PredictionRow | undefined, m: Metric): number =>
  r === undefined ? Infinity : rowError(s, r)[m];

/**
 * The G4 rows: σ = 1° turning scenarios at sample `manoeuvre_index + G4_SECONDS / dt`. A scenario
 * whose window ends before that point is skipped (none does under generator 0.4.0's margin); the
 * count is reported. Only rows at or after the turn's end are ever returned.
 */
export function g4Rows(truth: Iterable<Scenario>): { s: Scenario; k: number }[] {
  const rows: { s: Scenario; k: number }[] = [];
  for (const s of truth) {
    const m = s.metadata;
    if (!isSigma1(s) || m.manoeuvre_index == null) continue;
    const k = m.manoeuvre_index + Math.round(G4_SECONDS / m.parameters.dt_s);
    if (k < m.samples) rows.push({ s, k });
  }
  return rows;
}

/** Paired errors of two sets on the G4 rows. */
export function g4Paired(
  rows: { s: Scenario; k: number }[],
  a: PredictionSet,
  b: PredictionSet,
  metric: Metric,
): { a: Float64Array; b: Float64Array } {
  return {
    a: Float64Array.from(rows, ({ s, k }) => errorOf(s, rowAt(a, s, k), metric)),
    b: Float64Array.from(rows, ({ s, k }) => errorOf(s, rowAt(b, s, k), metric)),
  };
}

/** "Wholly at or below" a limit (Annex B G4-gross): pass at or below, fail wholly above. */
export function judgeAtOrBelow(value: number, lo: number, hi: number, limit: number): GateResult {
  if (value <= limit && hi <= limit) return "pass";
  if (lo > limit) return "fail";
  return "inconclusive";
}

const unit: Record<Metric, string> = { range_rel: "", course_deg: "°", speed_kt: " kt" };

/** The G4 checks of `network` against `reference` (spec 010 FR-008). */
export function g4Checks(
  truth: Iterable<Scenario>,
  network: PredictionSet,
  reference: PredictionSet,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): GateCheck[] {
  const all = Array.from(truth);
  const rows = g4Rows(all);
  if (rows.length === 0) throw new Error("G4: no σ = 1° turning rows at manoeuvre + 300 s");
  const checks: GateCheck[] = [];
  for (const [name, metric, gated] of [
    ["g4-range", "range_rel", true],
    ["g4-course", "course_deg", true],
    ["g4-speed-reported", "speed_kt", false],
  ] as const) {
    const { a, b } = g4Paired(rows, network, reference, metric);
    const r = bootstrapQuantileRatio(a, b, 0.5, resamples, seed);
    const result = judge(r.ratio, r.lo, r.hi, G4_RATIO);
    checks.push({
      name,
      result,
      value: r.ratio,
      threshold: G4_RATIO,
      ci_low: r.lo,
      ci_high: r.hi,
      ci_level: 0.95,
      detail: `${gated ? "" : "reported, not gated: "}${network.label} / ${reference.label} median ${metric} ${r.ratio.toFixed(4)} vs limit ${String(G4_RATIO)} on σ = 1° turning scenarios at manoeuvre+${String(G4_SECONDS)}s; 95% CI [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}] (paired bootstrap, ${String(r.resamples)} resamples, n ${String(r.n)})`,
    });
  }
  const { a, b } = g4Paired(rows, network, reference, "range_rel");
  const ga = Uint8Array.from(a, (x) => (x <= GROSS_RANGE_REL ? 0 : 1));
  const gb = Uint8Array.from(b, (x) => (x <= GROSS_RANGE_REL ? 0 : 1));
  const d = bootstrapRateDifference(ga, gb, resamples, seed);
  const rate = (g: Uint8Array): number => g.reduce((t, x) => t + x, 0) / g.length;
  checks.push({
    name: "g4-gross",
    result: judgeAtOrBelow(d.difference, d.lo, d.hi, 0),
    value: d.difference,
    threshold: 0,
    ci_low: d.lo,
    ci_high: d.hi,
    ci_level: 0.95,
    detail: `gross-error rate (range error > ${String(GROSS_RANGE_REL * 100)}% or no converged estimate; a non-converged row counts as gross for either estimator) ${network.label} ${(rate(ga) * 100).toFixed(3)}% vs ${reference.label} ${(rate(gb) * 100).toFixed(3)}% at manoeuvre+${String(G4_SECONDS)}s; difference ${(d.difference * 100).toFixed(3)} pp, 95% CI [${(d.lo * 100).toFixed(3)}, ${(d.hi * 100).toFixed(3)}] pp, limit: wholly at or below 0 (paired bootstrap, ${String(d.resamples)} resamples, n ${String(d.n)})`,
  });
  checks.push(...g4Control(all, network, resamples, seed));
  return checks;
}

/** G4-control: G2's three checks for the network on the σ = 1° held-course scenarios. */
export function g4Control(
  truth: Scenario[],
  network: PredictionSet,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): GateCheck[] {
  const held = truth.filter((s) => isSigma1(s) && s.metadata.manoeuvre_index == null);
  return G2_CRITERIA.map((c) => {
    const xs: number[] = [];
    for (const s of held) {
      const m = s.metadata;
      const k = m.zig_index + Math.round(c.seconds / m.parameters.dt_s);
      if (k < m.samples) xs.push(errorOf(s, rowAt(network, s, k), c.metric));
    }
    if (xs.length === 0)
      throw new Error(`G4-control: no held-course rows at zig+${String(c.seconds)}s`);
    const r = bootstrapMedian(Float64Array.from(xs), resamples, seed);
    return {
      name: `g4-control-${c.name}`,
      result: judge(r.median, r.lo, r.hi, c.threshold),
      value: r.median,
      threshold: c.threshold,
      ci_low: r.lo,
      ci_high: r.hi,
      ci_level: 0.95,
      detail: `${network.label} median ${c.metric} ${r.median.toFixed(4)}${unit[c.metric]} vs G2 limit ${String(c.threshold)}${unit[c.metric]} on σ = 1° held-course scenarios at zig+${String(c.seconds)}s; 95% CI [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}] (bootstrap, ${String(r.resamples)} resamples, n ${String(r.n)})`,
    };
  });
}

/**
 * Pass when G4-range, G4-course, G4-gross and every G4-control check pass; fail when any of them
 * fails; otherwise inconclusive. G4-speed is reported only.
 */
export function g4Verdict(checks: GateCheck[]): GateVerdict {
  const gated = checks.filter((c) => c.name !== "g4-speed-reported");
  const result: GateResult = gated.some((c) => c.result === "fail")
    ? "fail"
    : gated.every((c) => c.result === "pass")
      ? "pass"
      : "inconclusive";
  return { gate: "G4", result, checks, decided_by: "harness (pending agent panel review)" };
}
