// Angles, units and float32 rounding (SRD §2 frame: x east, y north; bearings clockwise from north).

export const TWO_PI = 2 * Math.PI;
export const KNOT_MPS = 1852 / 3600;
export const DEG = Math.PI / 180;

/**
 * Round to the nearest float32 (constitution II: stored values are float32). Negative zero is
 * normalised to +0 because JSON cannot represent it, which would break NDJSON ↔ pack round-trips.
 */
export const f32 = (x: number): number => Math.fround(x) + 0;

/** Wrap to [0, 2π) and round to float32, keeping the result strictly below 2π. */
export function f32Angle(a: number): number {
  const v = f32(wrap2pi(a));
  return v >= TWO_PI ? 0 : v;
}

/** Wrap an angle to [0, 2π). */
export function wrap2pi(a: number): number {
  const w = a % TWO_PI;
  const r = w < 0 ? w + TWO_PI : w;
  return r >= TWO_PI ? 0 : r;
}

/** Signed smallest difference a − b, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** True bearing of the vector (dx east, dy north), clockwise from north, in [0, 2π). */
export function bearingOf(dx: number, dy: number): number {
  return wrap2pi(Math.atan2(dx, dy));
}

export const ktToMps = (kt: number): number => kt * KNOT_MPS;
export const mpsToKt = (mps: number): number => mps / KNOT_MPS;
export const degToRad = (deg: number): number => deg * DEG;
export const radToDeg = (rad: number): number => rad / DEG;
