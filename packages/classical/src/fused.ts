// The fused tracker (phase 4c, SRD Annex C §C.11, spec 014): the frozen reference IMM with a
// learned tracker's range as a second measurement. After each bearing update, every `every`
// samples counted from zig_index + 1, the network's range enters as a log-range measurement whose
// standard deviation is the network's own stated log-range sd times `k` (immRangeUpdate). One
// state carries range and velocity, unlike the phase-4b tracker hybrid. k and `every` thin and
// inflate the network's information because its errors are correlated in time and with the
// bearings the IMM already uses. Causal: sample i reads the network's row at sample i only.
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import {
  ekfLogRangeSd,
  ekfName,
  ekfPredict,
  ekfRangeUpdate,
  type ProcessAdapt,
  type TrackerScales,
} from "./ekf.js";
import { type ImmParams, immName, immPredict, immRangeUpdate } from "./imm.js";

/** Fusion settings: every parameter the decision record freezes beside the IMM's. */
export interface FusionParams {
  /** Inflation on the network's stated log-range sd. */
  k: number;
  /** Range update every this many samples, from zig_index + 1. */
  every: number;
  /**
   * Fade (spec 029, EKF fusion only): when the filter's own log-range sd σ_f falls below
   * `fade` × the network's inflated sd s = k·sd, the network's sd becomes s · fade · s / σ_f, so
   * its weight falls as the bearings fix range. Absent or 0: no fade.
   */
  fade?: number;
  /** Adaptive process noise (spec 029, EKF fusion only); absent: σa fixed. */
  adapt?: ProcessAdapt;
}

/** Frozen in decision 31 (spec 014 research: the middle of the validation plateau). */
export const FUSION_DEFAULT: FusionParams = { k: 4, every: 6 };

/** Estimator name of the fused tracker. */
export const fusedName = (network: string, tracker: ImmParams, f: FusionParams): string =>
  `fused-${network}-${immName(tracker)}-k${String(f.k)}-m${String(f.every)}`;

/**
 * Whether a network row can enter as a log-range measurement: converged, with a positive finite
 * range and a positive finite stated log-range sd (spec 015 FR-004). ln(range) is undefined at or
 * below 0, and a zero, negative or non-finite sd would make the update singular or meaningless.
 * No scored row fails this (spec 015 R4), so the guard leaves every committed result unchanged.
 */
export function usableRange(r: PredictionRow): boolean {
  const sd = r.log_range_sd;
  return (
    r.converged &&
    Number.isFinite(r.range_m) &&
    r.range_m > 0 &&
    sd != null &&
    Number.isFinite(sd) &&
    sd > 0
  );
}

/**
 * Fused-tracker estimate for one scenario: the IMM's rows (`immPredict`, re-initialisation
 * included) with the network's range fused in. A network row that fails `usableRange` (not
 * converged, range ≤ 0, or no positive finite log-range sd) adds nothing at that sample.
 */
export function fusedPredict(
  s: Scenario,
  params: ImmParams,
  network: Prediction,
  f: FusionParams = FUSION_DEFAULT,
): Prediction {
  if ((f.fade !== undefined && f.fade !== 0) || f.adapt !== undefined)
    throw new Error("the fade and adaptive σa (spec 029) apply to the EKF fusion only");
  const rows = checkInputs(s, network, f);
  const first = s.metadata.zig_index + 1;
  const own = s.ownship.states;
  const p = immPredict(s, params, undefined, (i, st) => {
    const m = measurementAt(rows, own, first, f, i);
    return m === null ? st : immRangeUpdate(st, m.range, f.k * m.sd, m.ox, m.oy).st;
  });
  return { ...p, estimator: fusedName(network.estimator, params, f) };
}

/** The network's range measurement at sample i under the fusion schedule, or null. */
function measurementAt(
  rows: Map<number, PredictionRow>,
  own: Scenario["ownship"]["states"],
  first: number,
  f: FusionParams,
  i: number,
): { range: number; sd: number; ox: number; oy: number } | null {
  if ((i - first) % f.every !== 0) return null;
  const r = rows.get(i);
  const o = own[i];
  const sd = r?.log_range_sd;
  if (r === undefined || o === undefined || sd == null || !usableRange(r)) return null;
  return { range: r.range_m, sd, ox: o.x_m, oy: o.y_m };
}

function checkInputs(
  s: Scenario,
  network: Prediction,
  f: FusionParams,
): Map<number, PredictionRow> {
  if (f.fade !== undefined && !(f.fade >= 0 && Number.isFinite(f.fade)))
    throw new Error(`fusion fade must be a finite number ≥ 0, got ${String(f.fade)}`);
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
  return new Map(network.rows.map((r) => [Math.round(r.timestamp_s / dt), r]));
}

/** Estimator name of the EKF-fused tracker (spec 028). */
export const fusedEkfName = (
  network: string,
  sigmaA: number,
  scales: TrackerScales,
  f: FusionParams,
): string =>
  `fused-${network}-${ekfName(sigmaA, scales)}-k${String(f.k)}-m${String(f.every)}` +
  (f.fade === undefined || f.fade === 0 ? "" : `-f${String(f.fade)}`) +
  (f.adapt === undefined ? "" : `-a${String(f.adapt.hi)}-e${String(f.adapt.eta)}`);

/**
 * The network's sd after the fade (spec 029): s = k·sd, unchanged while the filter's own log-range
 * sd σ_f is at least fade · s, else s · fade · s / σ_f.
 */
export function fadedSd(s: number, sigmaF: number, fade: number | undefined): number {
  if (fade === undefined || fade === 0) return s;
  const floor = fade * s;
  return sigmaF >= floor ? s : (s * floor) / Math.max(sigmaF, 1e-12);
}

/**
 * EKF-fused tracker estimate for one scenario (spec 028, SRD Annex F): `ekfPredict`'s rows
 * (re-initialisation included) with the network's range fused in on the same schedule and with the
 * same rules as `fusedPredict`. A constant-velocity EKF has no manoeuvre model; the range
 * measurement is what lets it recover after a turn.
 */
export function fusedEkfPredict(
  s: Scenario,
  sigmaA: number,
  scales: TrackerScales,
  network: Prediction,
  f: FusionParams = FUSION_DEFAULT,
): Prediction {
  const rows = checkInputs(s, network, f);
  const first = s.metadata.zig_index + 1;
  const own = s.ownship.states;
  const p = ekfPredict(
    s,
    sigmaA,
    scales,
    (i, st) => {
      const m = measurementAt(rows, own, first, f, i);
      if (m === null) return st;
      const sd = fadedSd(f.k * m.sd, ekfLogRangeSd(st, m.ox, m.oy), f.fade);
      return ekfRangeUpdate(st, m.range, sd, m.ox, m.oy);
    },
    f.adapt,
  );
  return { ...p, estimator: fusedEkfName(network.estimator, sigmaA, scales, f) };
}
