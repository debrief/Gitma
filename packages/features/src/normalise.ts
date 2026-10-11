// Normalisation constants from INPUT channels of the train split only (constitution IV: no leakage).
import { f32 } from "@tma/sim";
import type { NormalisationConstants, Scenario } from "@tma/types";

/**
 * Scales are the maxima over the train split of |ownship x|, |ownship y| (km), ownship speed and
 * timestamp. Only ownship states and timestamps are read; target truth never is.
 */
export function computeNormalisation(
  train: Iterable<Scenario>,
  trainHeaderDigest: string,
): NormalisationConstants {
  let pos = 0;
  let speed = 0;
  let time = 0;
  for (const s of train) {
    for (const o of s.ownship.states) {
      pos = Math.max(pos, Math.abs(o.x_m), Math.abs(o.y_m));
      speed = Math.max(speed, o.speed_mps);
      time = Math.max(time, o.timestamp_s);
    }
  }
  if (pos === 0 || speed === 0 || time === 0) throw new Error("degenerate training inputs");
  return {
    position_scale_km: f32(pos / 1000),
    speed_scale_mps: f32(speed),
    time_scale_s: f32(time),
    computed_from: "inputs_only",
    train_header_digest: trainHeaderDigest,
  };
}
