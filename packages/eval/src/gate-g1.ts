// G1 (SRD §5): both model variants beat half the naive baseline's median range error at zig+300s,
// plus the consistency, control and shuffled-label checks of spec 002 (research R8).
import type { CurvePoint, GateCheck, GateVerdict, MetricsRecord } from "@tma/types";

export const G1_POINT = "zig+300s";
/** G1 threshold: model median range error < this × naive. */
export const G1_RATIO = 0.5;
/** Time-late may be at most this much worse than instantaneous at any curve point. */
export const CONSISTENCY_SLACK = 1.05;
/** Shuffled-label model must sit within this fraction of naive. */
export const LEAKAGE_BAND = 0.1;

export interface G1Ids {
  instantaneous: string;
  timeLate: string;
  causalControl: string;
  mlpControl: string;
  shuffled?: string;
}

/** Metric label of a per-timestep prediction file (see loadPredictionSet). */
export const perTimestep = (estimator: string): string => `${estimator}:per_timestep`;

const check = (name: string, pass: boolean, detail: string): GateCheck => ({
  name,
  result: pass ? "pass" : "fail",
  detail,
});

const fmt = (v: number): string => v.toFixed(4);

function median(metrics: MetricsRecord[], estimator: string, point: string): number {
  const label = perTimestep(estimator);
  const m = metrics.find(
    (r) => r.estimator === label && r.slice === "overall" && r.point === point,
  );
  const v = m?.range_rel_median;
  if (v === undefined || v === null)
    throw new Error(`no overall ${point} range_rel_median for ${label}`);
  return v;
}

function g1Check(name: string, metrics: MetricsRecord[], id: string): GateCheck {
  const naive = median(metrics, "naive", G1_POINT);
  const model = median(metrics, id, G1_POINT);
  const limit = G1_RATIO * naive;
  return check(
    name,
    model < limit,
    `${id} median range error ${fmt(model)} vs limit ${fmt(limit)} (${String(G1_RATIO)} × naive ${fmt(naive)}) at ${G1_POINT}`,
  );
}

export function checkConsistency(curves: CurvePoint[], ids: G1Ids): GateCheck {
  const curve = (id: string) =>
    new Map(
      curves
        .filter((c) => c.estimator === perTimestep(id))
        .map((c) => [c.t_since_zig_s, c.range_rel_median]),
    );
  const inst = curve(ids.instantaneous);
  const late = curve(ids.timeLate);
  const bad: string[] = [];
  let n = 0;
  for (const [t, l] of late) {
    const i = inst.get(t);
    if (i === undefined) continue;
    n++;
    if (!(l <= CONSISTENCY_SLACK * i)) bad.push(`t=${String(t)}s ${fmt(l)} > ${fmt(i)}`);
  }
  return check(
    "time-late-not-worse",
    n > 0 && bad.length === 0,
    n === 0
      ? "no shared curve points"
      : bad.length === 0
        ? `time-late ≤ ${String(CONSISTENCY_SLACK)} × instantaneous at all ${String(n)} curve points`
        : `${String(bad.length)}/${String(n)} points worse: ${bad.slice(0, 5).join("; ")}`,
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
    return { p, ok: m < c, text: `${p}: ${fmt(m)} vs ${fmt(c)}` };
  });
  return check(
    name,
    parts.every((x) => x.ok),
    `${model} vs ${control} median range error — ${parts.map((x) => x.text).join(", ")}`,
  );
}

export function checkLeakage(metrics: MetricsRecord[], shuffled: string): GateCheck {
  const naive = median(metrics, "naive", G1_POINT);
  const s = median(metrics, shuffled, G1_POINT);
  const ratio = s / naive;
  return check(
    "shuffled-labels-at-naive",
    Math.abs(ratio - 1) <= LEAKAGE_BAND,
    `${shuffled} median range error ${fmt(s)} = ${ratio.toFixed(3)} × naive ${fmt(naive)} (allowed 1 ± ${String(LEAKAGE_BAND)}) at ${G1_POINT}`,
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

export function g1Checks(metrics: MetricsRecord[], curves: CurvePoint[], ids: G1Ids): GateCheck[] {
  requireBaselineMetrics(metrics);
  const checks = [
    g1Check("g1-instantaneous", metrics, ids.instantaneous),
    g1Check("g1-time-late", metrics, ids.timeLate),
    checkConsistency(curves, ids),
    checkBeatsControl("instantaneous-beats-control", metrics, ids.instantaneous, ids.causalControl),
    checkBeatsControl("time-late-beats-control", metrics, ids.timeLate, ids.mlpControl),
  ];
  if (ids.shuffled !== undefined) checks.push(checkLeakage(metrics, ids.shuffled));
  return checks;
}

export function g1Verdict(checks: GateCheck[]): GateVerdict {
  return {
    gate: "G1",
    result: checks.every((c) => c.result === "pass") ? "pass" : "fail",
    checks,
    decided_by: "harness (pending team review)",
  };
}
