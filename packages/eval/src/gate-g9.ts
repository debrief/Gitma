// G9 (SRD Annex D §D.3; spec 025): the composite solver keeps the best of both estimators. On G5's
// rows (σ = 1°, zig + 5/10/15/20 min) under realistic bearing error:
// - g9-range-vs-fused, g9-course-vs-fused: median error over all rows, composite / fused tracker,
//   wholly below 1;
// - g9-straight-range, -course, -speed: on straight-leg rows (settled, before any target
//   manoeuvre), composite / batch least squares (the composite's own classical input), wholly
//   below 1.1;
// - g9-speed-vs-fused-reported: reported, not gated.
// One carried estimator, so each interval is a scenario-clustered paired bootstrap at 95%. Every
// gated check must pass (an intersection–union test: no multiplicity correction is needed).
import type { GateCheck, GateResult, GateVerdict, Scenario } from "@tma/types";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapClusteredQuantileRatio,
} from "./bootstrap.js";
import type { PredictionSet } from "./evaluate.js";
import { judge } from "./gate-g3.js";
import { clustersOf, errorOf, type G5Row, g5Rows, type Metric, rowAt } from "./gate-g5.js";

export const G9_LEVEL = 0.95;
export const G9_RATIO = 1;
export const G9_STRAIGHT_RATIO = 1.1;

export const G9_GATED = [
  "g9-range-vs-fused",
  "g9-course-vs-fused",
  "g9-straight-range",
  "g9-straight-course",
  "g9-straight-speed",
] as const;

/** A straight-leg row: settled, and no target manoeuvre has started (so none has ended). */
export const straightRow = (r: G5Row): boolean =>
  r.settled && !(r.s.metadata.manoeuvres ?? []).some((m) => m.start_index <= r.k);

/** The G9 checks of `composite` against `fused` (all rows) and `classical` (straight legs). */
export function g9Checks(
  truth: Iterable<Scenario>,
  composite: PredictionSet,
  fused: PredictionSet,
  classical: PredictionSet,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): GateCheck[] {
  const all = g5Rows(truth);
  if (all.length === 0) throw new Error("G9: no σ = 1° rows at zig + 5–20 min");
  const straight = all.filter(straightRow);
  if (straight.length === 0) throw new Error("G9: no straight-leg rows");
  const checks: GateCheck[] = [];
  const ratio = (
    name: string,
    rows: G5Row[],
    metric: Metric,
    limit: number,
    against: PredictionSet,
    gated: boolean,
    what: string,
  ): void => {
    const a = Float64Array.from(rows, (r) => errorOf(r.s, rowAt(composite, r.s, r.k), metric));
    const b = Float64Array.from(rows, (r) => errorOf(r.s, rowAt(against, r.s, r.k), metric));
    const x = bootstrapClusteredQuantileRatio(
      a,
      b,
      clustersOf(rows),
      0.5,
      G9_LEVEL,
      resamples,
      seed,
    );
    checks.push({
      name,
      result: judge(x.ratio, x.lo, x.hi, limit),
      value: x.ratio,
      threshold: limit,
      ci_low: x.lo,
      ci_high: x.hi,
      ci_level: G9_LEVEL,
      detail: `${gated ? "" : "reported, not gated: "}${composite.label} / ${against.label} median ${metric} on ${what} ${x.ratio.toFixed(4)} vs limit ${String(limit)}; ${String(G9_LEVEL * 100)}% CI [${x.lo.toFixed(4)}, ${x.hi.toFixed(4)}] (scenario-clustered paired bootstrap, ${String(x.resamples)} resamples, ${String(x.n)} rows in ${String(x.clusters)} scenarios)`,
    });
  };
  const where = "σ = 1° rows at zig + 5/10/15/20 min";
  const sw = `straight-leg (settled, before any manoeuvre) ${where}`;
  ratio("g9-range-vs-fused", all, "range_rel", G9_RATIO, fused, true, where);
  ratio("g9-course-vs-fused", all, "course_deg", G9_RATIO, fused, true, where);
  ratio("g9-speed-vs-fused-reported", all, "speed_kt", G9_RATIO, fused, false, where);
  ratio("g9-straight-range", straight, "range_rel", G9_STRAIGHT_RATIO, classical, true, sw);
  ratio("g9-straight-course", straight, "course_deg", G9_STRAIGHT_RATIO, classical, true, sw);
  ratio("g9-straight-speed", straight, "speed_kt", G9_STRAIGHT_RATIO, classical, true, sw);
  return checks;
}

/** Pass if every gated check passes, fail if any fails, otherwise inconclusive. */
export function g9Verdict(checks: GateCheck[]): GateVerdict {
  const gated = checks.filter((c) => (G9_GATED as readonly string[]).includes(c.name));
  if (gated.length !== G9_GATED.length) throw new Error("G9: gated checks missing");
  const result: GateResult = gated.some((c) => c.result === "fail")
    ? "fail"
    : gated.every((c) => c.result === "pass")
      ? "pass"
      : "inconclusive";
  return { gate: "G9", result, checks, decided_by: "harness (pending agent panel review)" };
}
