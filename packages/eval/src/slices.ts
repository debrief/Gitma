// Slicing keys (research R8): range band by mean range, zig band by |zig angle|, noise σ, and
// dropout band by the drawn dropout fraction (spec 003 R11; not the realised count), and the
// target's course change (spec 010: held, or its angle band).
import type { ScenarioMetadata } from "@tma/types";
import { radToDeg } from "@tma/sim";

const RANGE_BANDS_KM: [number, number][] = [
  [0, 2],
  [2, 5],
  [5, 10],
  [10, 20],
  [20, 30],
];
const ZIG_BANDS_DEG: [number, number][] = [
  [30, 50],
  [50, 70],
  [70, 90],
  // Iteration 3 (spec 007): across-the-line-of-sight turns reach 180°.
  [90, 120],
  [120, 150],
  [150, 180],
];

// Phase 3 (spec 010): the target's course change, drawn in [30°, 120°].
const MANOEUVRE_BANDS_DEG: [number, number][] = [
  [30, 60],
  [60, 90],
  [90, 120],
];

const DROPOUT_BANDS_PCT: [number, number][] = [
  [0, 5],
  [5, 10],
];

function band(value: number, bands: [number, number][], unit: string): string {
  for (const [lo, hi] of bands) {
    if (value >= lo && value < hi) return `${String(lo)}-${String(hi)}${unit}`;
  }
  const last = bands.at(-1);
  if (last !== undefined && value >= last[1]) return `${String(last[1])}+${unit}`;
  return "other";
}

/**
 * Zig angles are drawn in [30°, 90°] (random rule) or fall in [30°, 180°] (across-LOS rule);
 * float32 rounding can land exactly on 90° (kept in 70–90°, as before iteration 3) or just
 * outside [30°, 180°].
 */
function zigBand(deg: number): string {
  if (deg >= 90 && deg < 90.001) return "70-90deg";
  if (deg >= 180 && deg < 180.001) return "150-180deg";
  if (deg < 30 && deg > 29.999) return "30-50deg";
  return band(deg, ZIG_BANDS_DEG, "deg");
}

/** Dropout fractions are drawn in [0, 0.10]; float32 rounding can land just above 10%. */
export function dropoutBand(fraction: number): string {
  const pct = fraction * 100;
  const b = band(pct, DROPOUT_BANDS_PCT, "pct");
  return b === "10+pct" && pct < 10.001 ? "5-10pct" : b;
}

/**
 * "held" when the target holds course, else the band of |course change|, from the drawn
 * parameters: a scenario cut before its turn (G0's `beforeManoeuvre`) keeps its band. Float32
 * rounding can land just outside [30°, 120°] or exactly on 60° or 90° (kept in the band above, as
 * `band` does).
 */
export function manoeuvreBand(m: ScenarioMetadata): string {
  // Generator 0.5.0: the drawn plan, as course-change count plus a speed-change mark ("2turns+speed").
  const plan = m.parameters.target_manoeuvres;
  if (plan != null) {
    const turns = plan.filter((x) => x.kind === "course").length;
    const speed = plan.some((x) => x.kind === "speed");
    if (turns === 0 && !speed) return "held";
    return `${String(turns)}turn${turns === 1 ? "" : "s"}${speed ? "+speed" : ""}`;
  }
  const a = m.parameters.target_manoeuvre_angle_rad;
  if (a == null) return "held";
  const deg = Math.abs(radToDeg(a));
  if (deg >= 120 && deg < 120.001) return "90-120deg";
  if (deg < 30 && deg > 29.999) return "30-60deg";
  return band(deg, MANOEUVRE_BANDS_DEG, "deg");
}

/** Every slice a scenario belongs to, "overall" first. */
export function sliceKeys(m: ScenarioMetadata): string[] {
  const p = m.parameters;
  const sigmaDeg = Math.round(radToDeg(p.noise_sigma_rad) * 100) / 100;
  return [
    "overall",
    `range_band=${band(m.mean_range_m / 1000, RANGE_BANDS_KM, "km")}`,
    `zig_band=${zigBand(Math.abs(radToDeg(p.zig_angle_rad)))}`,
    `sigma=${String(sigmaDeg)}deg`,
    `dropout_band=${dropoutBand(p.dropout_fraction)}`,
    `manoeuvre=${manoeuvreBand(m)}`,
  ];
}
