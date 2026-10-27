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
