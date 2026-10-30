// Model tensors (SRD §4, FeatureLayout in schema/tma.yaml). Pure functions over Float32Array.
import type { FeatureSet, NormalisationConstants, Scenario } from "@tma/types";
import { bearingLineIntercept, scenarioBearingRate } from "./derived.js";

/** Rows per window up to phase 3 (generators 0.1.0–0.4.0, windows up to 40 min at 10 s). */
export const ROWS = 240;

/**
 * Rows per window for a dataset's ranges: `ROWS`, or more when its longest window needs them
 * (generator 0.5.0's 60-min windows: 360). Recorded in the features file's layout (`rows`).
 */
export const rowsFor = (r: { window_s: { max: number }; dt_s: number }): number =>
  Math.max(ROWS, Math.floor(r.window_s.max / r.dt_s));
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
/** Channels the `derived` feature set appends to the raw ones (spec 003 research R6). */
export const DERIVED_CHANNELS = ["bearing_rate_scaled", "rate_valid", "intercept_scaled"] as const;
/** Input width of the `raw` feature set (iteration 1). */
export const NI = INPUT_CHANNELS.length;
/** Input width of the `derived` feature set. */
export const NI_DERIVED = NI + DERIVED_CHANNELS.length;
export const NT = TARGET_CHANNELS.length;
/** Index of `window_mask` in every feature set (derived channels come after it). */
export const WINDOW_MASK = INPUT_CHANNELS.indexOf("window_mask");

/** Input channel names of a feature set, in tensor order. */
export const inputChannels = (fs: FeatureSet): readonly string[] =>
  fs === "derived" ? [...INPUT_CHANNELS, ...DERIVED_CHANNELS] : INPUT_CHANNELS;

/** Input width (channels per row) of a feature set: 10 (raw) or 13 (derived). */
export const inputWidth = (fs: FeatureSet): number => (fs === "derived" ? NI_DERIVED : NI);

/** The derived set's rate scale; refuses norm files built without it. */
export function rateScale(norm: NormalisationConstants): number {
  const v = norm.bearing_rate_scale_rad_s;
  if (typeof v !== "number" || !Number.isFinite(v) || !(v > 0)) {
    throw new Error(
      "normalisation has no bearing_rate_scale_rad_s: the derived feature set needs a norm file built with --feature-set derived",
    );
  }
  return v;
}

export interface Window {
  /** [rows × width], row-major (width 10 for raw, 13 for derived; rows `ROWS` or `rowsFor`). */
  inputs: Float32Array;
  /** [rows × NT], row-major. */
  targets: Float32Array;
  /** [rows]: 1 inside the window after the zig (rows > zig_index), else 0. */
  lossMask: Float32Array;
}

/**
 * One scenario → padded tensors. Padding rows are all zero. Dropout rows keep ownship and time
 * channels with bearing sin/cos = 0 and valid = 0. Positions are km divided by
 * `position_scale_km`; speeds by `speed_scale_mps`; time by `time_scale_s`.
 *
 * The `derived` set appends, per row: the trailing least-squares bearing rate ÷
 * `bearing_rate_scale_rad_s`, its validity flag, and the bearing-line intercept in km ÷
 * `position_scale_km` (derived.ts). All three are 0 on dropout and padding rows.
 */
export function buildWindow(
  s: Scenario,
  norm: NormalisationConstants,
  featureSet: FeatureSet = "raw",
  rows: number = ROWS,
): Window {
  const n = s.metadata.samples;
  if (n > rows)
    throw new Error(`scenario ${String(s.metadata.index)}: ${String(n)} > ${String(rows)} rows`);
  const ni = inputWidth(featureSet);
  const derived = featureSet === "derived";
  const scale = derived ? rateScale(norm) : 1;
  const rate = derived ? scenarioBearingRate(s) : undefined;
  const inputs = new Float32Array(rows * ni);
  const targets = new Float32Array(rows * NT);
  const lossMask = new Float32Array(rows);
  for (let i = 0; i < n; i++) {
    const o = s.ownship.states[i];
    const t = s.target.states[i];
    const z = s.observations[i];
    if (o === undefined || t === undefined || z === undefined)
      throw new Error(`sample ${String(i)}`);
    const a = i * ni;
    if (z.valid) {
      inputs[a] = Math.sin(z.bearing_rad);
      inputs[a + 1] = Math.cos(z.bearing_rad);
      inputs[a + 8] = 1;
      if (rate !== undefined) {
        if (rate.valid[i] === 1) {
          inputs[a + NI] = (rate.rate[i] ?? 0) / scale;
          inputs[a + NI + 1] = 1;
        }
        inputs[a + NI + 2] =
          bearingLineIntercept(o.x_m, o.y_m, z.bearing_rad) / 1000 / norm.position_scale_km;
      }
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
