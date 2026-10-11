import type { ParameterRanges } from "@tma/types";
import { degToRad, ktToMps } from "./geometry.js";

/** Iteration-1 parameter ranges (SRD §3). */
export const DEFAULT_RANGES: ParameterRanges = {
  window_s: { min: 600, max: 2400 },
  dt_s: 10,
  ownship_speed_mps: { min: ktToMps(5), max: ktToMps(15) },
  zig_angle_abs_rad: { min: degToRad(30), max: degToRad(90) },
  zig_fraction: { min: 0.4, max: 0.6 },
  target_range0_m: { min: 2000, max: 20000 },
  range_distribution: "log_uniform",
  target_speed_mps: { min: ktToMps(3), max: ktToMps(20) },
  noise_sigma_rad_values: [degToRad(0.5), degToRad(1), degToRad(2)],
  dropout_fraction: { min: 0, max: 0.1 },
  min_range_m: 100,
};

/** Held-out geometry: initial ranges outside training (SRD §3 example, 20–30 km). */
export const HELDOUT_RANGES: ParameterRanges = {
  ...DEFAULT_RANGES,
  target_range0_m: { min: 20000, max: 30000 },
};

/** The same ranges with σ = 0 and no dropouts (G0). */
export function noiseFree(ranges: ParameterRanges): ParameterRanges {
  return { ...ranges, noise_sigma_rad_values: [0], dropout_fraction: { min: 0, max: 0 } };
}
