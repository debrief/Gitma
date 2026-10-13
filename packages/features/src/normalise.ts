// Normalisation constants from INPUT channels of the train split only (constitution IV: no leakage).
import { f32 } from "@tma/sim";
import type { FeatureSet, NormalisationConstants, Scenario } from "@tma/types";
import { appendAbsRates, rateBuffer, rateQuantile } from "./derived.js";

/**
 * Scales are the maxima over the train split of |ownship x|, |ownship y| (km), ownship speed and
 * timestamp. Only ownship states, timestamps and (derived set) observed bearings are read; target
 * truth never is. The derived set adds `bearing_rate_scale_rad_s`, the 90th percentile of
 * |trailing least-squares bearing rate| over the train rows that have one (derived.ts). One pass.
 */
export function computeNormalisation(
  train: Iterable<Scenario>,
  trainHeaderDigest: string,
  featureSet: FeatureSet = "raw",
): NormalisationConstants {
  let pos = 0;
  let speed = 0;
  let time = 0;
  const rates = featureSet === "derived" ? rateBuffer() : undefined;
  for (const s of train) {
    for (const o of s.ownship.states) {
      pos = Math.max(pos, Math.abs(o.x_m), Math.abs(o.y_m));
      speed = Math.max(speed, o.speed_mps);
      time = Math.max(time, o.timestamp_s);
    }
    if (rates !== undefined) appendAbsRates(s, rates);
  }
  if (pos === 0 || speed === 0 || time === 0) throw new Error("degenerate training inputs");
  return {
    position_scale_km: f32(pos / 1000),
    speed_scale_mps: f32(speed),
    time_scale_s: f32(time),
    ...(rates === undefined
      ? {}
      : { bearing_rate_scale_rad_s: rateQuantile(rates.data.subarray(0, rates.length)) }),
    computed_from: "inputs_only",
    train_header_digest: trainHeaderDigest,
  };
}
