// Hybrid estimator (spec 009; SRD Annex A lever B.2.6): the classical solver's estimate, replaced
// by a network's where the two disagree. Pure functions over prediction records.
//
// Research R2 showed that starting the solver from the network changes almost nothing: classical's
// gross errors are mostly the least-squares optimum itself lying far from the truth, not a missed
// basin. Where that happens the network is usually still near the truth, so the hybrid keeps
// classical's estimate unless classical has no converged estimate, or the two ranges disagree by
// more than SWITCH_RANGE_REL of the network's range; then it reports the network's row.
import type { Prediction, PredictionRow } from "@tma/types";

/** Disagreement threshold: |r_classical − r_network| / r_network (the gross-error bound). */
export const SWITCH_RANGE_REL = 0.5;

/** Estimator name of the hybrid of classical and network `id`. */
export const hybridName = (id: string): string => `hybrid-${id}`;

/** Whether the hybrid takes the network's row in place of classical's. */
export function useNetwork(classical: PredictionRow, network: PredictionRow): boolean {
  if (!classical.converged) return true;
  if (!(network.range_m > 0)) return false;
  return !(Math.abs(classical.range_m - network.range_m) / network.range_m <= SWITCH_RANGE_REL);
}

/**
 * Per-timestep hybrid of one scenario: classical's rows, each replaced by the network's row at the
 * same time when `useNetwork`. Both must be per-timestep predictions of the same scenario with the
 * same timestamps. The network must be causal (the instantaneous model), so the hybrid is causal.
 */
export function hybridSwitch(classical: Prediction, network: Prediction): Prediction {
  const id = classical.scenario_index;
  if (network.scenario_index !== id)
    throw new Error(
      `network prediction is for scenario ${String(network.scenario_index)}, not ${String(id)}`,
    );
  if (classical.mode !== "per_timestep" || network.mode !== "per_timestep")
    throw new Error(`scenario ${String(id)}: the hybrid needs per-timestep rows from both`);
  if (classical.rows.length !== network.rows.length)
    throw new Error(
      `scenario ${String(id)}: ${String(classical.rows.length)} classical rows, ${String(network.rows.length)} network rows`,
    );
  const rows = classical.rows.map((c, i) => {
    const n = network.rows[i];
    if (n === undefined || n.timestamp_s !== c.timestamp_s)
      throw new Error(`scenario ${String(id)}: row ${String(i)} times differ`);
    return useNetwork(c, n) ? n : c;
  });
  return {
    record: "prediction",
    scenario_index: id,
    estimator: hybridName(network.estimator),
    mode: "per_timestep",
    rows,
  };
}

// Tracker hybrid (spec 013; SRD Annex C §C.10, owner decision 30): the frozen IMM reference and the
// frozen recurrent tracker T2. T2 wins on range everywhere and on velocity after manoeuvres; the
// IMM wins on velocity on straight segments. The two disagree on course mostly while the IMM lags
// a manoeuvre, so the hybrid reports T2's range always, and T2's velocity only where the two
// courses differ by more than a threshold; elsewhere the IMM's velocity. Causal if both are.

/** Course-disagreement threshold, chosen on seed-211 validation (spec 013 R2) and frozen. */
export const TRACKER_SWITCH_COURSE_DEG = 45;

/** Estimator name of the tracker hybrid of `tracker` and `network` at threshold `deg`. */
export const trackerHybridName = (network: string, tracker: string, deg: number): string =>
  `hybrid-${network}-${tracker}-c${String(deg)}`;

const wrapAbs = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

/**
 * Whether the hybrid takes the network's velocity (course and speed) at this row. At deg 180
 * (spec 022) a converged tracker's velocity is always kept: wrapped course differences are ≤ 180°.
 */
export function useNetworkVelocity(
  tracker: PredictionRow,
  network: PredictionRow,
  deg: number = TRACKER_SWITCH_COURSE_DEG,
): boolean {
  if (!tracker.converged) return true;
  return wrapAbs(tracker.course_rad - network.course_rad) > (deg * Math.PI) / 180;
}

/**
 * One row of the tracker hybrid: the network's row (range, position and its stated range sd),
 * with the tracker's course and speed unless `useNetworkVelocity`. A network row that has not
 * converged yields the tracker's row unchanged.
 */
export function trackerHybridRow(
  tracker: PredictionRow,
  network: PredictionRow,
  deg: number = TRACKER_SWITCH_COURSE_DEG,
): PredictionRow {
  if (!network.converged) return tracker;
  if (useNetworkVelocity(tracker, network, deg)) return network;
  const row: PredictionRow = {
    ...network,
    course_rad: tracker.course_rad,
    speed_mps: tracker.speed_mps,
  };
  delete row.vx_sd_mps;
  delete row.vy_sd_mps;
  return row;
}

/** Per-timestep tracker hybrid of one scenario (same scenario, mode and timestamps required). */
export function trackerHybrid(
  tracker: Prediction,
  network: Prediction,
  deg: number = TRACKER_SWITCH_COURSE_DEG,
): Prediction {
  const id = tracker.scenario_index;
  if (network.scenario_index !== id)
    throw new Error(
      `network prediction is for scenario ${String(network.scenario_index)}, not ${String(id)}`,
    );
  if (tracker.mode !== "per_timestep" || network.mode !== "per_timestep")
    throw new Error(`scenario ${String(id)}: the hybrid needs per-timestep rows from both`);
  if (tracker.rows.length !== network.rows.length)
    throw new Error(
      `scenario ${String(id)}: ${String(tracker.rows.length)} tracker rows, ${String(network.rows.length)} network rows`,
    );
  const rows = tracker.rows.map((t, i) => {
    const n = network.rows[i];
    if (n === undefined || n.timestamp_s !== t.timestamp_s)
      throw new Error(`scenario ${String(id)}: row ${String(i)} times differ`);
    return trackerHybridRow(t, n, deg);
  });
  return {
    record: "prediction",
    scenario_index: id,
    estimator: trackerHybridName(network.estimator, tracker.estimator, deg),
    mode: "per_timestep",
    rows,
  };
}
