// Slicing keys (research R8): range band by mean range, zig band by |zig angle|, noise σ.
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
];

function band(value: number, bands: [number, number][], unit: string): string {
  for (const [lo, hi] of bands) {
    if (value >= lo && value < hi) return `${String(lo)}-${String(hi)}${unit}`;
  }
  const last = bands.at(-1);
  if (last !== undefined && value >= last[1]) return `${String(last[1])}+${unit}`;
  return "other";
}

/** Zig angles are drawn in [30°, 90°]; float32 rounding can land exactly on 90°. */
function zigBand(deg: number): string {
  const b = band(deg, ZIG_BANDS_DEG, "deg");
  return b === "90+deg" && deg < 90.001 ? "70-90deg" : b;
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
  ];
}
