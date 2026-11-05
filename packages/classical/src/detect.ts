// Manoeuvre detectors (spec 017; SRD Annex C §C.6 item 1, §C.12). Each turns a scenario, or
// prediction records, into a per-timestep score; an alarm is the score at or above the
// detector's threshold, which is set on validation (the gate, not here). Rows run from
// zig_index + 1, as every tracker's. Pure functions; causal: row i reads data up to sample i.
//
// - CUSUM on the reference IMM's innovations (the baseline; `CusumKind`): on the normalised
//   innovation squared (variance) or, two-sided, on the signed normalised innovation (mean
//   shift), each clipped so that one outlier (0.2% of quiet NIS values exceed 10) cannot hold an
//   alarm for hours. It restarts at 0 when the tracker has no state (before a
//   re-initialisation). A missing bearing leaves it unchanged.
// - Course disagreement (learned, from frozen models): |course_network − course_tracker| in
//   degrees at the same row, the statistic the phase-4b hybrid switched on. 0 where either row
//   is not converged.
// - Course rate (learned): |course_network(i) − course_network(i − w)| in degrees, the network's
//   own course change over the last w samples. 0 until w converged rows are available.
import type { Detection, DetectionRow, Prediction, Scenario } from "@tma/types";
import { f32 } from "@tma/sim";
import { type ImmParams, immName, immPredict } from "./imm.js";

/**
 * The CUSUM's statistic: `nis` (variance: g = max(0, g + min(NIS, clip) − c)) or `mean` (a turn
 * biases the bearing innovations to one side: two-sided on e = ν/√S clipped to ±clip,
 * g± = max(0, g± ± e − c), score max(g+, g−)).
 */
export type CusumKind = "nis" | "mean";

/** Settings of a CUSUM detector: statistic, drift c > 0, clip > 0 (robust: bounds one step). */
export interface CusumParams {
  kind: CusumKind;
  c: number;
  clip: number;
}

/** Estimator name of the CUSUM detector on the IMM with `p`. */
export const cusumName = (p: ImmParams, q: CusumParams): string =>
  `cusum-${q.kind}-${immName(p)}-c${String(q.c)}-x${String(q.clip)}`;
/** Name of the course-disagreement detector. */
export const disagreementName = (network: string, tracker: string): string =>
  `disagree-${network}-${tracker}`;
/** Name of the course-rate detector over `w` samples. */
export const courseRateName = (network: string, w: number): string =>
  `crate-${network}-w${String(w)}`;

const RAD = 180 / Math.PI;
const wrapAbsDeg = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * RAD;

const detection = (s: number, detector: string, rows: DetectionRow[]): Detection => ({
  record: "detection",
  scenario_index: s,
  detector,
  rows,
});

/** The CUSUM detector's scores for one scenario. */
export function cusumDetect(s: Scenario, params: ImmParams, q: CusumParams): Detection {
  if (!(q.c > 0) || !Number.isFinite(q.c))
    throw new Error(`CUSUM drift must be > 0, got ${String(q.c)}`);
  if (!(q.clip > 0) || !Number.isFinite(q.clip))
    throw new Error(`CUSUM clip must be > 0, got ${String(q.clip)}`);
  const kind: string = q.kind; // checked at run time: callers may come from untyped input
  if (kind !== "nis" && kind !== "mean") throw new Error("CUSUM kind must be nis or mean");
  const stat = new Map<number, number | null>();
  const p = immPredict(s, params, (i, st) =>
    stat.set(i, (q.kind === "nis" ? st.nis : st.innovation) ?? null),
  );
  const dt = s.metadata.parameters.dt_s;
  let up = 0;
  let down = 0;
  const rows = p.rows.map((r): DetectionRow => {
    const i = Math.round(r.timestamp_s / dt);
    if (!stat.has(i)) {
      up = 0;
      down = 0;
    } else {
      const v = stat.get(i);
      if (v != null && Number.isFinite(v)) {
        if (q.kind === "nis") up = Math.max(0, up + Math.min(v, q.clip) - q.c);
        else {
          const e = Math.max(-q.clip, Math.min(q.clip, v));
          up = Math.max(0, up + e - q.c);
          down = Math.max(0, down - e - q.c);
        }
      }
    }
    return { timestamp_s: r.timestamp_s, score: f32(Math.max(up, down)) };
  });
  return detection(s.metadata.index, cusumName(params, q), rows);
}

/** Pair rows of two per-timestep predictions of one scenario by timestamp. */
function paired(a: Prediction, b: Prediction): void {
  if (a.scenario_index !== b.scenario_index)
    throw new Error(
      `predictions are for scenarios ${String(a.scenario_index)} and ${String(b.scenario_index)}`,
    );
  if (a.mode !== "per_timestep" || b.mode !== "per_timestep")
    throw new Error(`scenario ${String(a.scenario_index)}: detectors need per-timestep rows`);
  if (a.rows.length !== b.rows.length)
    throw new Error(`scenario ${String(a.scenario_index)}: row counts differ`);
  a.rows.forEach((r, i) => {
    if (b.rows[i]?.timestamp_s !== r.timestamp_s)
      throw new Error(`scenario ${String(a.scenario_index)}: row ${String(i)} times differ`);
  });
}

/** Course disagreement between a network and a tracker, row by row (degrees). */
export function disagreementDetect(network: Prediction, tracker: Prediction): Detection {
  paired(network, tracker);
  const rows = network.rows.map((n, i): DetectionRow => {
    const t = tracker.rows[i];
    const ok = n.converged && t !== undefined && t.converged;
    return {
      timestamp_s: n.timestamp_s,
      score: ok ? f32(wrapAbsDeg(n.course_rad - t.course_rad)) : 0,
    };
  });
  return detection(
    network.scenario_index,
    disagreementName(network.estimator, tracker.estimator),
    rows,
  );
}

/** A network's own course change over the last `w` rows (degrees). */
export function courseRateDetect(network: Prediction, w: number): Detection {
  if (!Number.isInteger(w) || w < 1)
    throw new Error(`course-rate window must be ≥ 1, got ${String(w)}`);
  if (network.mode !== "per_timestep")
    throw new Error(`scenario ${String(network.scenario_index)}: detectors need per-timestep rows`);
  const rows = network.rows.map((n, i): DetectionRow => {
    const back = network.rows[i - w];
    const ok = n.converged && back !== undefined && back.converged;
    return {
      timestamp_s: n.timestamp_s,
      score: ok ? f32(wrapAbsDeg(n.course_rad - back.course_rad)) : 0,
    };
  });
  return detection(network.scenario_index, courseRateName(network.estimator, w), rows);
}
