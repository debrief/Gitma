// G1 (SRD §5): both model variants beat half the naive baseline's median range error at zig+300s,
// plus the consistency, control and shuffled-label checks of spec 002 (research R8), combined by
// the tiered rule in g1Verdict.
import type { CurvePoint, GateCheck, GateResult, GateVerdict, MetricsRecord } from "@tma/types";
import type { RatioInterval } from "./bootstrap.js";

export const G1_SECONDS = 300;
export const G1_POINT = `zig+${String(G1_SECONDS)}s`;
/** G1 threshold: model median range error < this × naive. */
export const G1_RATIO = 0.5;
/** Time-late may be at most this much worse than instantaneous at any curve point. */
export const CONSISTENCY_SLACK = 1.05;
/** Shuffled-label model must sit within this fraction of naive. */
export const LEAKAGE_BAND = 0.1;
/** Curve points with fewer scenarios are reported but not gated (median too noisy). */
export const CONSISTENCY_MIN_N = 500;

/** Paired bootstrap intervals of model/naive median range error at the G1 point (T033). */
export interface G1Intervals {
  instantaneous?: RatioInterval;
  timeLate?: RatioInterval;
}

export interface G1Ids {
  instantaneous: string;
  timeLate: string;
  causalControl: string;
  mlpControl: string;
  /** Required: FR-013 / SC-004 make the leakage check part of every G1 verdict. */
  shuffled: string;
}

/** Metric label of a per-timestep prediction file (see loadPredictionSet). */
export const perTimestep = (estimator: string): string => `${estimator}:per_timestep`;

const check = (name: string, pass: boolean, detail: string): GateCheck => ({
  name,
  result: pass ? "pass" : "fail",
  detail,
});

const fmt = (v: number): string => v.toFixed(4);

function record(metrics: MetricsRecord[], estimator: string, point: string): MetricsRecord {
  const label = perTimestep(estimator);
  const m = metrics.find(
    (r) => r.estimator === label && r.slice === "overall" && r.point === point,
  );
  if (m === undefined || m.n === 0) throw new Error(`no overall ${point} metrics for ${label}`);
  return m;
}

/** Overall median range error; absent (non-finite: mostly non-converged) counts as +Infinity. */
function median(metrics: MetricsRecord[], estimator: string, point: string): number {
  return record(metrics, estimator, point).range_rel_median ?? Infinity;
}

/** R8 "same scenarios": both estimators scored on the same rows at `point`. */
function sameSample(metrics: MetricsRecord[], a: string, b: string, point: string): boolean {
  const ra = record(metrics, a, point);
  const rb = record(metrics, b, point);
  return ra.n === rb.n && ra.excluded === rb.excluded;
}

function g1Check(
  name: string,
  metrics: MetricsRecord[],
  id: string,
  ci?: RatioInterval,
): GateCheck {
  const nv = record(metrics, "naive", G1_POINT);
  const mv = record(metrics, id, G1_POINT);
  const naive = nv.range_rel_median ?? Infinity;
  const model = mv.range_rel_median ?? Infinity;
  const limit = G1_RATIO * naive;
  // R8 "same scenarios": the model and naive must be scored on the same rows at the gate point.
  const same = mv.n === nv.n && mv.excluded === nv.excluded;
  // Without a finite naive median there is no limit to beat: the check cannot pass.
  const naiveOk = Number.isFinite(naive);
  const valid = same && naiveOk;
  let result: GateResult = valid && model < limit ? "pass" : "fail";
  let ciText = "; no bootstrap interval";
  if (ci !== undefined) {
    // With an interval, the point estimate alone does not decide: the whole 95% interval of
    // model/naive must sit below the ratio to pass, above it to fail; otherwise inconclusive.
    result = !valid
      ? "fail"
      : ci.hi < G1_RATIO
        ? "pass"
        : ci.lo >= G1_RATIO
          ? "fail"
          : "inconclusive";
    ciText = `; model/naive ${ci.ratio.toFixed(3)}, 95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] (paired bootstrap, ${String(ci.resamples)} resamples, n ${String(ci.n)})`;
  }
  return {
    name,
    result,
    detail:
      `${id} median range error ${fmt(model)} vs limit ${fmt(limit)} (${String(G1_RATIO)} × naive ${fmt(naive)}) at ${G1_POINT}; ` +
      `n ${String(mv.n)} (naive ${String(nv.n)}), excluded ${String(mv.excluded)} (naive ${String(nv.excluded)})` +
      (same ? "" : " — sample mismatch") +
      (naiveOk ? "" : " — naive median not finite") +
      ciText,
  };
}

export function checkConsistency(curves: CurvePoint[], ids: G1Ids): GateCheck {
  const curve = (id: string) =>
    new Map(curves.filter((c) => c.estimator === perTimestep(id)).map((c) => [c.t_since_zig_s, c]));
  const inst = curve(ids.instantaneous);
  const late = curve(ids.timeLate);
  const bad: string[] = [];
  let n = 0;
  let skipped = 0;
  for (const [t, l] of late) {
    const i = inst.get(t);
    if (i === undefined) continue;
    if (Math.min(i.n, l.n) < CONSISTENCY_MIN_N) {
      skipped++;
      continue;
    }
    n++;
    const lv = l.range_rel_median ?? Infinity;
    const iv = i.range_rel_median ?? Infinity;
    if (!(Number.isFinite(lv) && lv <= CONSISTENCY_SLACK * iv))
      bad.push(`t=${String(t)}s ${fmt(lv)} > ${fmt(iv)}`);
  }
  const tail = ` (${String(skipped)} later points with n < ${String(CONSISTENCY_MIN_N)} reported, not gated)`;
  return check(
    "time-late-not-worse",
    n > 0 && bad.length === 0,
    n === 0
      ? `no shared curve points with n ≥ ${String(CONSISTENCY_MIN_N)}`
      : bad.length === 0
        ? `time-late ≤ ${String(CONSISTENCY_SLACK)} × instantaneous at all ${String(n)} curve points${tail}`
        : `${String(bad.length)}/${String(n)} points worse: ${bad.slice(0, 5).join("; ")}${tail}`,
  );
}

export function checkBeatsControl(
  name: string,
  metrics: MetricsRecord[],
  model: string,
  control: string,
): GateCheck {
  const parts = [G1_POINT, "final"].map((p) => {
    const m = median(metrics, model, p);
    const c = median(metrics, control, p);
    const same = sameSample(metrics, model, control, p);
    return {
      p,
      ok: same && m < c,
      text: `${p}: ${fmt(m)} vs ${fmt(c)}${same ? "" : " (sample mismatch)"}`,
    };
  });
  return check(
    name,
    parts.every((x) => x.ok),
    `${model} vs ${control} median range error — ${parts.map((x) => x.text).join(", ")}`,
  );
}

/** Overall course error median in degrees at `point`, or "n/a" when absent or non-finite. */
function courseText(metrics: MetricsRecord[], estimator: string, point: string): string {
  const c = record(metrics, estimator, point).course_deg_median;
  return c === undefined || c === null || !Number.isFinite(c) ? "n/a" : `${c.toFixed(1)}°`;
}

/**
 * Shuffled-label check. Pass/fail is on range error only, as pre-registered; the course error
 * median beside naive's is reported in the detail (a weak bearing-as-course prior shows there).
 */
export function checkLeakage(metrics: MetricsRecord[], shuffled: string): GateCheck {
  const naive = median(metrics, "naive", G1_POINT);
  const s = median(metrics, shuffled, G1_POINT);
  const ratio = s / naive;
  const same = sameSample(metrics, shuffled, "naive", G1_POINT);
  const course = `course error median ${courseText(metrics, shuffled, G1_POINT)} vs naive ${courseText(metrics, "naive", G1_POINT)} (reported, not gated)`;
  return check(
    "shuffled-labels-at-naive",
    same && Math.abs(ratio - 1) <= LEAKAGE_BAND,
    `${shuffled} median range error ${fmt(s)} = ${ratio.toFixed(3)} × naive ${fmt(naive)} (allowed 1 ± ${String(LEAKAGE_BAND)}) at ${G1_POINT}${same ? "" : " — sample mismatch"}; ${course}`,
  );
}

/** FR-019: no model verdict without both baselines in the same evaluation. */
function requireBaselineMetrics(metrics: MetricsRecord[]): void {
  for (const b of ["naive", "classical"]) {
    if (!metrics.some((r) => r.estimator === perTimestep(b))) {
      throw new Error(`refusing to judge G1 without per-timestep ${b} metrics (FR-019)`);
    }
  }
}

export function g1Checks(
  metrics: MetricsRecord[],
  curves: CurvePoint[],
  ids: G1Ids,
  intervals: G1Intervals = {},
): GateCheck[] {
  requireBaselineMetrics(metrics);
  const checks = [
    g1Check("g1-instantaneous", metrics, ids.instantaneous, intervals.instantaneous),
    g1Check("g1-time-late", metrics, ids.timeLate, intervals.timeLate),
    checkConsistency(curves, ids),
    checkBeatsControl("instantaneous-beats-control", metrics, ids.instantaneous, ids.causalControl),
    checkBeatsControl("time-late-beats-control", metrics, ids.timeLate, ids.mlpControl),
  ];
  checks.push(checkLeakage(metrics, ids.shuffled));
  return checks;
}

/** The two SRD §5 ratio checks: they alone decide G1 when the evidence is valid. */
export const G1_RATIO_CHECKS = ["g1-instantaneous", "g1-time-late"];

/**
 * Tiered G1 verdict (user, 2026-10-11): the ratio checks decide, except that a shuffled-label
 * failure voids the evidence (fail) and a time-late consistency failure makes the pipeline suspect
 * (at best inconclusive, investigate). Control checks are reported only: failing one removes the
 * "sequential learning" claim, not the G1 pass.
 */
export function g1Verdict(checks: GateCheck[]): GateVerdict {
  const failed = (name: string): boolean =>
    checks.some((c) => c.name === name && c.result === "fail");
  const ratio = checks.filter((c) => G1_RATIO_CHECKS.includes(c.name));
  const result: GateResult =
    failed("shuffled-labels-at-naive") || ratio.some((c) => c.result === "fail")
      ? "fail"
      : failed("time-late-not-worse") || ratio.some((c) => c.result === "inconclusive")
        ? "inconclusive"
        : "pass";
  return { gate: "G1", result, checks, decided_by: "harness (pending agent panel review)" };
}
