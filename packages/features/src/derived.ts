// Derived input channels (SRD §4; spec 003 US3, research R6). Pure functions over numeric arrays
// (constitution III): no classes, no hidden state, no target truth.
//
// - Bearing rate: least-squares slope of the bearing against time over the valid samples in the
//   trailing RATE_WINDOW_ROWS rows (row t included, nothing after it: causal). Bearings are unwrapped
//   relative to row t's bearing, so a track crossing north (0/2π) has no jump.
// - Bearing-line intercept: x_o cos b − y_o sin b. A target at (x, y) on the bearing line from
//   ownship (x_o, y_o) satisfies x cos b − y sin b = x_o cos b − y_o sin b (the pseudo-linear
//   measurement), so each row is one linear equation in the target's track given sin b, cos b, t.
//
// All three channels are 0 on dropout rows (no bearing) and on padding rows.
import { f32, TWO_PI } from "@tma/sim";
import type { Scenario } from "@tma/types";

/** Trailing window for the bearing rate: 18 rows = 3 min at 10 s (research R6). */
export const RATE_WINDOW_ROWS = 18;
/** Fewer valid samples than this in the window ⇒ no rate (rate_valid = 0, rate = 0). */
export const MIN_RATE_SAMPLES = 3;
/** The rate scale is this quantile of |rate| over the train split's valid-rate rows. */
export const RATE_SCALE_QUANTILE = 0.9;

export interface BearingRate {
  /** rad/s per row; 0 where `valid` is 0. */
  rate: Float64Array;
  /** 1 where a rate was computed (row has a bearing and ≥ MIN_RATE_SAMPLES valid in the window). */
  valid: Uint8Array;
}

/**
 * Trailing least-squares bearing rate for rows 0..n−1. Row t uses only rows max(0, t−w+1)..t, so
 * changing any later row cannot change it (causality). A row without a bearing gets rate 0 and
 * valid 0, as does a row with fewer than `minSamples` valid samples in its window.
 */
export function trailingBearingRate(
  time_s: ArrayLike<number>,
  bearing_rad: ArrayLike<number>,
  observed: ArrayLike<boolean>,
  n: number,
  window: number = RATE_WINDOW_ROWS,
  minSamples: number = MIN_RATE_SAMPLES,
): BearingRate {
  const rate = new Float64Array(n);
  const valid = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (observed[t] !== true) continue;
    const bt = bearing_rad[t] ?? NaN;
    const tt = time_s[t] ?? NaN;
    let m = 0;
    let st = 0;
    let su = 0;
    let stt = 0;
    let stu = 0;
    for (let k = Math.max(0, t - window + 1); k <= t; k++) {
      if (observed[k] !== true) continue;
      // Time and unwrapped bearing relative to row t: small numbers, and no 0/2π jump.
      const tau = (time_s[k] ?? NaN) - tt;
      const d = (bearing_rad[k] ?? NaN) - bt;
      const u = d - TWO_PI * Math.round(d / TWO_PI); // in [−π, π]
      m++;
      st += tau;
      su += u;
      stt += tau * tau;
      stu += tau * u;
    }
    if (m < minSamples) continue;
    const den = m * stt - st * st;
    if (!(den > 0)) continue;
    const r = (m * stu - st * su) / den;
    if (!Number.isFinite(r)) continue;
    rate[t] = r;
    valid[t] = 1;
  }
  return { rate, valid };
}

/** Bearing-line intercept x_o cos b − y_o sin b (same unit as x_o, y_o). */
export const bearingLineIntercept = (ownX: number, ownY: number, bearing: number): number =>
  ownX * Math.cos(bearing) - ownY * Math.sin(bearing);

/** Trailing bearing rate of one scenario, from its observations only (bearing, valid, time). */
export function scenarioBearingRate(s: Scenario): BearingRate {
  const n = s.metadata.samples;
  const obs = s.observations;
  return trailingBearingRate(
    obs.map((o) => o.timestamp_s),
    obs.map((o) => o.bearing_rad),
    obs.map((o) => o.valid),
    n,
  );
}

/**
 * `bearing_rate_scale_rad_s`: the RATE_SCALE_QUANTILE (nearest rank) of |rate| over every
 * valid-rate row of the train scenarios, float32. Reads observations only (inputs, never truth).
 */
export function bearingRateScale(train: Iterable<Scenario>): number {
  const b = rateBuffer();
  for (const s of train) appendAbsRates(s, b);
  return rateQuantile(b.data.subarray(0, b.length));
}

/** Growable float32 buffer of |rate| values (plain data; appendAbsRates extends it). */
export interface RateBuffer {
  data: Float32Array;
  length: number;
}

export const rateBuffer = (): RateBuffer => ({ data: new Float32Array(1 << 16), length: 0 });

/** Appends one scenario's |rate| on its valid-rate rows to `b`. */
export function appendAbsRates(s: Scenario, b: RateBuffer): void {
  const { rate, valid } = scenarioBearingRate(s);
  for (let i = 0; i < rate.length; i++) {
    if (valid[i] !== 1) continue;
    if (b.length === b.data.length) {
      const bigger = new Float32Array(b.data.length * 2);
      bigger.set(b.data);
      b.data = bigger;
    }
    b.data[b.length++] = Math.abs(rate[i] ?? 0);
  }
}

/** Nearest-rank quantile of |rates| (sorted copy); throws on no rows or a zero scale. */
export function rateQuantile(abs: Float32Array, q: number = RATE_SCALE_QUANTILE): number {
  if (abs.length === 0) throw new Error("no valid bearing-rate rows in the training inputs");
  const sorted = Float32Array.from(abs).sort();
  const v = sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
  if (!(v > 0)) throw new Error("degenerate bearing-rate scale (0)");
  return f32(v);
}
