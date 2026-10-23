// Output parameterisations (spec 008): how the model's four output channels encode course and
// speed. The features file always stores the course_speed targets (layout.ts); training re-encodes
// them per model, and decode.ts inverts the encoding. Pure, shared by training, prediction and the
// browser viewer.
import type { NormalisationConstants, OutputParameterisation } from "@tma/types";

export interface OutputSpec {
  parameterisation: OutputParameterisation;
  /** m/s; used only by velocity. */
  velocityScaleMps: number;
}

export const COURSE_SPEED: OutputSpec = { parameterisation: "course_speed", velocityScaleMps: 1 };

/** The output spec a training config names; refuses velocity without a positive scale. */
export function outputSpec(config: {
  output_parameterisation?: OutputParameterisation | null | undefined;
  velocity_scale_mps?: number | null | undefined;
}): OutputSpec {
  const p = config.output_parameterisation ?? "course_speed";
  if (p === "course_speed") return COURSE_SPEED;
  const v = config.velocity_scale_mps;
  if (typeof v !== "number" || !Number.isFinite(v) || !(v > 0))
    throw new Error("output_parameterisation velocity needs a positive velocity_scale_mps");
  return { parameterisation: p, velocityScaleMps: v };
}

/**
 * Training targets for one row: the first four stored target channels (log_range_km, course_sin,
 * course_cos, speed / speed_scale_mps), re-encoded for `spec`, written to out[o .. o + 3].
 */
export function encodeTargets(
  stored: ArrayLike<number>,
  s: number,
  norm: NormalisationConstants,
  spec: OutputSpec,
  out: Float32Array,
  o: number,
): void {
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
  out[o + 3] = 0;
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
