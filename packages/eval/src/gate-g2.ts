// G2 (SRD §5): each gated variant's median range error < 20% and course error < 10° five minutes
// after the zig, and speed error < 1 kt ten minutes after it (SRD §5 as amended 2026-10-11, spec
// 003 decision 8 / R12), on the σ = 1° slice, each with a bootstrap 95% interval (R7, R8). The
// iteration-1 checks are repeated on the noisy test set (FR-016).
import type { CurvePoint, GateCheck, GateResult, GateVerdict, MetricsRecord } from "@tma/types";
import type { BootstrapReport, IntervalMetric, RatioInterval } from "./bootstrap.js";
import { G1_POINT, G1_RATIO_CHECKS, type G1Ids, g1Checks, perTimestep } from "./gate-g1.js";

/** G2 slice: σ = 1° (slice key from slices.ts). */
export const G2_SLICE = "sigma=1deg";

export type G2CriterionName = "range" | "course" | "speed";

export interface G2Criterion {
  name: G2CriterionName;
  metric: IntervalMetric;
  field: "range_rel_median" | "course_deg_median" | "speed_kt_median";
  /** Pass needs the whole 95% interval of the median below this. */
  threshold: number;
  /** Default gate point, seconds after the zig. */
  seconds: number;
  unit: string;
}

/** SRD §5 G2 thresholds and the point each is judged at. */
export const G2_CRITERIA: readonly G2Criterion[] = [
  {
    name: "range",
    metric: "range_rel",
    field: "range_rel_median",
    threshold: 0.2,
    seconds: 300,
    unit: "",
  },
  {
    name: "course",
    metric: "course_deg",
    field: "course_deg_median",
    threshold: 10,
    seconds: 300,
    unit: "°",
  },
  {
    name: "speed",
    metric: "speed_kt",
    field: "speed_kt_median",
    threshold: 1,
    seconds: 600,
    unit: " kt",
  },
];

export interface G2Options {
  slice: string;
  /** Gate point per criterion, seconds after the zig (defaults from G2_CRITERIA). */
  seconds: Record<G2CriterionName, number>;
}

export const DEFAULT_G2_OPTIONS: G2Options = {
  slice: G2_SLICE,
  seconds: { range: 300, course: 300, speed: 600 },
};

const NAIVE = perTimestep("naive");
const CLASSICAL = perTimestep("classical");

const fmt = (v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? "∞" : v.toFixed(4);

function find(
  metrics: MetricsRecord[],
  label: string,
  slice: string,
  point: string,
): MetricsRecord | undefined {
  return metrics.find((r) => r.estimator === label && r.slice === slice && r.point === point);
}

/** Refuses (exit 2) when an input the gate needs is missing, rather than failing a check. */
function requireInputs(
  metrics: MetricsRecord[],
  bootstrap: BootstrapReport,
  ids: G1Ids,
  opts: G2Options,
): void {
  for (const b of [NAIVE, CLASSICAL]) {
    if (!metrics.some((r) => r.estimator === b)) {
      throw new Error(`refusing to judge G2 without per-timestep ${b} metrics (FR-019)`);
    }
  }
  for (const id of [ids.instantaneous, ids.timeLate]) {
    for (const c of G2_CRITERIA) {
      const point = `zig+${String(opts.seconds[c.name])}s`;
      const label = perTimestep(id);
      if (find(metrics, label, opts.slice, point) === undefined) {
        throw new Error(`no ${opts.slice} ${point} metrics for ${label} (run tma-eval --points)`);
      }
      const ci = bootstrap.medians.some(
        (m) =>
          m.estimator === label &&
          m.slice === opts.slice &&
          m.point === point &&
          m.metric === c.metric,
      );
      if (!ci)
        throw new Error(`no bootstrap interval for ${label} ${c.metric} ${opts.slice} ${point}`);
    }
  }
}

/** One G2 threshold check for one variant (T030). */
export function g2Check(
  metrics: MetricsRecord[],
  bootstrap: BootstrapReport,
  variant: string,
  id: string,
  c: G2Criterion,
  opts: G2Options = DEFAULT_G2_OPTIONS,
): GateCheck {
  const point = `zig+${String(opts.seconds[c.name])}s`;
  const label = perTimestep(id);
  const m = find(metrics, label, opts.slice, point);
  const nv = find(metrics, NAIVE, opts.slice, point);
  const cl = find(metrics, CLASSICAL, opts.slice, point);
  const ci = bootstrap.medians.find(
    (x) =>
      x.estimator === label && x.slice === opts.slice && x.point === point && x.metric === c.metric,
  );
  const value = m?.[c.field] ?? Infinity;
  const lo = ci?.lo ?? Infinity;
  const hi = ci?.hi ?? Infinity;
  // FR-014 "same scenarios": the model must be scored on the rows naive and classical were.
  const same = (r: MetricsRecord | undefined): boolean =>
    m !== undefined && r !== undefined && r.n === m.n && r.excluded === m.excluded;
  const sameSample = same(nv) && same(cl);
  // The interval must come from the same rows as the point estimate.
  const ciMatches = ci !== undefined && m !== undefined && ci.n === m.n && m.n > 0;
  const valid = sameSample && ciMatches;
  // FR-015 / R8: a CI containing the threshold is inconclusive, whatever side the point is on.
  const result: GateResult =
    !valid || !Number.isFinite(value) || lo >= c.threshold
      ? "fail"
      : hi < c.threshold && value < c.threshold
        ? "pass"
        : "inconclusive";
  // Scenarios too short to reach the point are excluded, not scored; the share kept is stated
  // because the kept set is not random (longer windows; G0 panel 2026-10-13, decision 13).
  const reached = (r: MetricsRecord | undefined): string =>
    r === undefined || r.n + r.excluded === 0
      ? "none"
      : `${(Math.round((1000 * r.n) / (r.n + r.excluded)) / 10).toFixed(1)}%`;
  const base = (r: MetricsRecord | undefined): string =>
    `${fmt(r?.[c.field] ?? undefined)} (n ${String(r?.n ?? 0)}, excluded ${String(r?.excluded ?? 0)})`;
  const level = `${String(Math.round(bootstrap.level * 100))}%`;
  const detail =
    `${variant} ${id} median ${c.name} error ${fmt(value)}${c.unit} vs threshold ${String(c.threshold)}${c.unit} ` +
    `on ${opts.slice} at ${point}; ${level} CI [${fmt(lo)}, ${fmt(hi)}] (bootstrap, ${String(bootstrap.resamples)} resamples, n ${String(ci?.n ?? 0)}); ` +
    `model n ${String(m?.n ?? 0)}, excluded ${String(m?.excluded ?? 0)} (${reached(m)} of the slice reach ${point}; decision 13); naive ${base(nv)}, classical ${base(cl)}` +
    (sameSample ? "" : " — sample mismatch with naive or classical") +
    (ciMatches ? "" : " — interval not from the scored rows");
  const check: GateCheck = { name: `g2-${variant}-${c.name}`, result, detail };
  if (Number.isFinite(value)) check.value = value;
  check.threshold = c.threshold;
  if (Number.isFinite(lo)) check.ci_low = lo;
  if (Number.isFinite(hi)) check.ci_high = hi;
  check.ci_level = bootstrap.level;
  return check;
}

/** Paired model/naive intervals at G1's point, from bootstrap.json, for the repeated G1 checks. */
function g1Intervals(bootstrap: BootstrapReport, ids: G1Ids): Record<string, RatioInterval> {
  const out: Record<string, RatioInterval> = {};
  for (const [key, id] of [
    ["instantaneous", ids.instantaneous],
    ["timeLate", ids.timeLate],
  ] as const) {
    const r = bootstrap.ratios.find(
      (x) =>
        x.estimator === perTimestep(id) &&
        x.reference === NAIVE &&
        x.slice === "overall" &&
        x.point === G1_POINT,
    );
    if (r === undefined) {
      throw new Error(`no bootstrap ratio interval for ${perTimestep(id)} / naive at ${G1_POINT}`);
    }
    out[key] = {
      ratio: r.ratio ?? Infinity,
      lo: r.lo ?? Infinity,
      hi: r.hi ?? Infinity,
      n: r.n,
      resamples: bootstrap.resamples,
      seed: bootstrap.seed,
    };
  }
  return out;
}

/**
 * Every G2 check: the six threshold checks, then the iteration-1 checks repeated on noisy data
 * (ratio to naive with paired intervals, time-late consistency, controls, shuffled labels).
 */
export function g2Checks(
  metrics: MetricsRecord[],
  curves: CurvePoint[],
  bootstrap: BootstrapReport,
  ids: G1Ids,
  opts: G2Options = DEFAULT_G2_OPTIONS,
): GateCheck[] {
  requireInputs(metrics, bootstrap, ids, opts);
  const checks: GateCheck[] = [];
  for (const [variant, id] of [
    ["instantaneous", ids.instantaneous],
    ["time-late", ids.timeLate],
  ] as const) {
    for (const c of G2_CRITERIA) checks.push(g2Check(metrics, bootstrap, variant, id, c, opts));
  }
  return [...checks, ...g1Checks(metrics, curves, ids, g1Intervals(bootstrap, ids))];
}

/**
 * G2 verdict (research R8): the threshold checks, the repeated ratio checks and the shuffled-label
 * check decide — `fail` if any fails, else `inconclusive` if any is inconclusive. The consistency
 * and control checks keep their G1 roles: a time-late consistency failure makes the gate at best
 * inconclusive; a control failure is reported only.
 */
export function g2Verdict(checks: GateCheck[]): GateVerdict {
  const decisive = checks.filter(
    (c) =>
      c.name.startsWith("g2-") ||
      G1_RATIO_CHECKS.includes(c.name) ||
      c.name === "shuffled-labels-at-naive",
  );
  const consistencyFailed = checks.some(
    (c) => c.name === "time-late-not-worse" && c.result === "fail",
  );
  const result: GateResult = decisive.some((c) => c.result === "fail")
    ? "fail"
    : consistencyFailed || decisive.some((c) => c.result === "inconclusive")
      ? "inconclusive"
      : "pass";
  return { gate: "G2", result, checks, decided_by: "harness (pending agent panel review)" };
}
