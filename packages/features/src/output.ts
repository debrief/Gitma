// Output parameterisations (spec 008, spec 011): how the model's output channels encode course
// and speed: four channels, or seven for velocity_two_hypothesis (two velocity hypotheses and a
// turn logit). The features file always stores the course_speed targets (layout.ts); training re-encodes
// them per model, and decode.ts inverts the encoding. Pure, shared by training, prediction and the
// browser viewer.
import type { NormalisationConstants, OutputParameterisation } from "@tma/types";

export interface OutputSpec {
  parameterisation: OutputParameterisation;
  /** m/s; used by velocity and velocity_two_hypothesis. */
  velocityScaleMps: number;
}

/**
 * Output channels per row: 4, 7 for velocity_two_hypothesis, 6 for velocity_gaussian, 1 for
 * manoeuvre_detector.
 */
export const outputWidth = (spec: OutputSpec): number =>
  spec.parameterisation === "velocity_two_hypothesis"
    ? 7
    : spec.parameterisation === "velocity_gaussian"
      ? 6
      : spec.parameterisation === "manoeuvre_detector"
        ? 1
        : 4;

export const COURSE_SPEED: OutputSpec = { parameterisation: "course_speed", velocityScaleMps: 1 };

/** The output spec a training config names; refuses velocity without a positive scale. */
export function outputSpec(config: {
  output_parameterisation?: OutputParameterisation | null | undefined;
  velocity_scale_mps?: number | null | undefined;
}): OutputSpec {
  const p = config.output_parameterisation ?? "course_speed";
  if (p === "course_speed") return COURSE_SPEED;
  if (p === "manoeuvre_detector") return { parameterisation: p, velocityScaleMps: 1 };
  const v = config.velocity_scale_mps;
  if (typeof v !== "number" || !Number.isFinite(v) || !(v > 0))
    throw new Error(`output_parameterisation ${p} needs a positive velocity_scale_mps`);
  return { parameterisation: p, velocityScaleMps: v };
}

/**
 * Whether the target's course at row `s` (an offset into stored targets) differs from its course
 * at row 0 of the same window: the turn label of velocity_two_hypothesis (spec 011). A target that
 * holds course has bit-identical stored course channels on every row (float32 truth), so any
 * difference means its turn has started.
 */
export function turnedLabel(stored: ArrayLike<number>, s: number): number {
  return stored[s + 1] !== stored[1] || stored[s + 2] !== stored[2] ? 1 : 0;
}

/** Rows a detector label looks back (spec 030): 5 min at dt 10 s. */
export const DETECTOR_LOOKBACK_ROWS = 30;

/**
 * The manoeuvre detector's label and loss mask at row `r` of a window's stored targets (stride
 * `nt`), spec 030. Label 1 if the stored course changed within the last `DETECTOR_LOOKBACK_ROWS`
 * rows; label 0 on quiet rows, where neither course nor speed changed (G5's and G6's settled rows);
 * mask 0 elsewhere (a speed change alone) and in a window's first rows, which lack the history.
 * Stored truth is float32 and bit-identical while the target holds course and speed.
 */
export function detectorLabel(
  stored: ArrayLike<number>,
  r: number,
  nt: number,
): { label: number; mask: number } {
  if (r < DETECTOR_LOOKBACK_ROWS) return { label: 0, mask: 0 };
  const at = (row: number, c: number): number => stored[row * nt + c] ?? NaN;
  let course = false;
  let speed = false;
  for (let j = 1; j <= DETECTOR_LOOKBACK_ROWS; j++) {
    const q = r - j;
    if (at(q, 1) !== at(r, 1) || at(q, 2) !== at(r, 2)) course = true;
    if (at(q, 3) !== at(r, 3)) speed = true;
  }
  if (course) return { label: 1, mask: 1 };
  return { label: 0, mask: speed ? 0 : 1 };
}

/**
 * Training targets for one row: the first four stored target channels (log_range_km, course_sin,
 * course_cos, speed / speed_scale_mps), re-encoded for `spec`, written to out[o .. o + 3]. With
 * velocity_two_hypothesis the fourth is the turn label (`turnedLabel`).
 */
export function encodeTargets(
  stored: ArrayLike<number>,
  s: number,
  norm: NormalisationConstants,
  spec: OutputSpec,
  out: Float32Array,
  o: number,
  nt = 6,
): void {
  if (spec.parameterisation === "manoeuvre_detector") {
    const { label, mask } = detectorLabel(stored, Math.round(s / nt), nt);
    out[o] = label;
    out[o + 1] = mask;
    out[o + 2] = 0;
    out[o + 3] = 0;
    return;
  }
  const logR = stored[s] ?? 0;
  const sin = stored[s + 1] ?? 0;
  const cos = stored[s + 2] ?? 0;
  const spd = stored[s + 3] ?? 0;
  out[o] = logR;
  if (spec.parameterisation === "course_speed") {
    out[o + 1] = sin;
    out[o + 2] = cos;
    out[o + 3] = spd;
    return;
  }
  const v = (spd * norm.speed_scale_mps) / spec.velocityScaleMps;
  out[o + 1] = v * sin;
  out[o + 2] = v * cos;
  out[o + 3] = spec.parameterisation === "velocity_two_hypothesis" ? turnedLabel(stored, s) : 0;
}

/** Course (as sin, cos) and speed in m/s from one row's outputs; NaN where undefined. */
export function decodeCourseSpeed(
  a: number,
  b: number,
  c: number,
  norm: NormalisationConstants,
  spec: OutputSpec,
): { sin: number; cos: number; speed: number } {
  if (spec.parameterisation === "course_speed")
    return { sin: a, cos: b, speed: c * norm.speed_scale_mps };
  // Velocity: course is the direction of (vx, vy), clockwise from north; speed its length.
  return { sin: a, cos: b, speed: Math.hypot(a, b) * spec.velocityScaleMps };
}
