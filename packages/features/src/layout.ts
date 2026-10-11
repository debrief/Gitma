// Model tensors (SRD §4, FeatureLayout in schema/tma.yaml). Pure functions over Float32Array.
import type { NormalisationConstants, Scenario } from "@tma/types";

export const ROWS = 240;
export const INPUT_CHANNELS = [
  "bearing_sin",
  "bearing_cos",
  "own_x_scaled",
  "own_y_scaled",
  "own_course_sin",
  "own_course_cos",
  "own_speed_scaled",
  "time_scaled",
  "valid",
  "window_mask",
] as const;
export const TARGET_CHANNELS = [
  "log_range_km",
  "course_sin",
  "course_cos",
  "speed_scaled",
  "x_km",
  "y_km",
] as const;
export const NI = INPUT_CHANNELS.length;
export const NT = TARGET_CHANNELS.length;

export interface Window {
  /** [ROWS × NI], row-major. */
  inputs: Float32Array;
  /** [ROWS × NT], row-major. */
  targets: Float32Array;
  /** [ROWS]: 1 inside the window after the zig (rows > zig_index), else 0. */
  lossMask: Float32Array;
}

/**
 * One scenario → padded tensors. Padding rows are all zero. Dropout rows keep ownship and time
 * channels with bearing sin/cos = 0 and valid = 0. Positions are km divided by
 * `position_scale_km`; speeds by `speed_scale_mps`; time by `time_scale_s`.
 */
export function buildWindow(s: Scenario, norm: NormalisationConstants): Window {
  const n = s.metadata.samples;
  if (n > ROWS)
    throw new Error(`scenario ${String(s.metadata.index)}: ${String(n)} > ${String(ROWS)} rows`);
  const inputs = new Float32Array(ROWS * NI);
  const targets = new Float32Array(ROWS * NT);
  const lossMask = new Float32Array(ROWS);
  for (let i = 0; i < n; i++) {
    const o = s.ownship.states[i];
    const t = s.target.states[i];
    const z = s.observations[i];
    if (o === undefined || t === undefined || z === undefined)
      throw new Error(`sample ${String(i)}`);
    const a = i * NI;
    if (z.valid) {
      inputs[a] = Math.sin(z.bearing_rad);
      inputs[a + 1] = Math.cos(z.bearing_rad);
      inputs[a + 8] = 1;
    }
    inputs[a + 2] = o.x_m / 1000 / norm.position_scale_km;
    inputs[a + 3] = o.y_m / 1000 / norm.position_scale_km;
    inputs[a + 4] = Math.sin(o.course_rad);
    inputs[a + 5] = Math.cos(o.course_rad);
    inputs[a + 6] = o.speed_mps / norm.speed_scale_mps;
    inputs[a + 7] = o.timestamp_s / norm.time_scale_s;
    inputs[a + 9] = 1;
    const b = i * NT;
    targets[b] = Math.log(Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m) / 1000);
    targets[b + 1] = Math.sin(t.course_rad);
    targets[b + 2] = Math.cos(t.course_rad);
    targets[b + 3] = t.speed_mps / norm.speed_scale_mps;
    targets[b + 4] = t.x_m / 1000;
    targets[b + 5] = t.y_m / 1000;
    if (i > s.metadata.zig_index) lossMask[i] = 1;
  }
  return { inputs, targets, lossMask };
}
