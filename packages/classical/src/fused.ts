// The fused tracker (phase 4c, SRD Annex C §C.11, spec 014): the frozen reference IMM with a
// learned tracker's range as a second measurement. After each bearing update, every `every`
// samples counted from zig_index + 1, the network's range enters as a log-range measurement whose
// standard deviation is the network's own stated log-range sd times `k` (immRangeUpdate). One
// state carries range and velocity, unlike the phase-4b tracker hybrid. k and `every` thin and
// inflate the network's information because its errors are correlated in time and with the
// bearings the IMM already uses. Causal: sample i reads the network's row at sample i only.
import type { Prediction, Scenario } from "@tma/types";
import { type ImmParams, immName, immPredict, immRangeUpdate } from "./imm.js";

/** Fusion settings: every parameter the decision record freezes beside the IMM's. */
export interface FusionParams {
  /** Inflation on the network's stated log-range sd. */
  k: number;
  /** Range update every this many samples, from zig_index + 1. */
  every: number;
}

/** Frozen in decision 31 (spec 014 research: the middle of the validation plateau). */
export const FUSION_DEFAULT: FusionParams = { k: 4, every: 6 };

/** Estimator name of the fused tracker. */
export const fusedName = (network: string, tracker: ImmParams, f: FusionParams): string =>
  `fused-${network}-${immName(tracker)}-k${String(f.k)}-m${String(f.every)}`;

/**
 * Fused-tracker estimate for one scenario: the IMM's rows (`immPredict`, re-initialisation
 * included) with the network's range fused in. A network row that is not converged, or has no
 * stated log-range sd, adds nothing at that sample.
 */
export function fusedPredict(
  s: Scenario,
  params: ImmParams,
  network: Prediction,
  f: FusionParams = FUSION_DEFAULT,
): Prediction {
  if (!(f.k > 0) || !Number.isInteger(f.every) || f.every < 1)
    throw new Error(
      `fusion needs k > 0 and an integer every ≥ 1, got k ${String(f.k)}, every ${String(f.every)}`,
    );
  if (network.scenario_index !== s.metadata.index)
    throw new Error(
      `network prediction is for scenario ${String(network.scenario_index)}, not ${String(s.metadata.index)}`,
    );
  if (network.mode !== "per_timestep")
    throw new Error(`scenario ${String(s.metadata.index)}: fusion needs per-timestep network rows`);
  const dt = s.metadata.parameters.dt_s;
  const rows = new Map(network.rows.map((r) => [Math.round(r.timestamp_s / dt), r]));
  const first = s.metadata.zig_index + 1;
  const own = s.ownship.states;
  const p = immPredict(s, params, undefined, (i, st) => {
    if ((i - first) % f.every !== 0) return st;
    const r = rows.get(i);
    const o = own[i];
    if (r === undefined || o === undefined || !r.converged || r.log_range_sd == null) return st;
    return immRangeUpdate(st, r.range_m, f.k * r.log_range_sd, o.x_m, o.y_m).st;
  });
  return { ...p, estimator: fusedName(network.estimator, params, f) };
}
