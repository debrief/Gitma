// Scenario generation (SRD §2–3): two-leg ownship, constant-velocity target, noisy bearings.
// Pure functions: every output is determined by (datasetSeed, index, ranges).
import type {
  FloatRange,
  Observation,
  ParameterRanges,
  PlatformState,
  Scenario,
  ScenarioParameters,
} from "@tma/types";
import { bearingOf, f32, f32Angle, TWO_PI, wrap2pi } from "./geometry.js";
import {
  createRng,
  deriveSeed,
  gaussian,
  logUniform,
  type RngState,
  uniform,
  uniform01,
  uniformInt,
} from "./prng.js";

export const GENERATOR_VERSION = "0.1.0";
const MAX_REDRAWS = 1000;

const draw = (s: RngState, r: FloatRange): number => uniform(s, r.min, r.max);

/** Draw one parameter set; every value float32-rounded so metadata describes the data exactly. */
export function drawParameters(s: RngState, ranges: ParameterRanges): ScenarioParameters {
  const dt = ranges.dt_s;
  const minSamples = Math.ceil(ranges.window_s.min / dt);
  const maxSamples = Math.floor(ranges.window_s.max / dt);
  const samples = minSamples + uniformInt(s, maxSamples - minSamples + 1);
  const ownshipSpeed = draw(s, ranges.ownship_speed_mps);
  const course0 = uniform(s, 0, TWO_PI);
  const zigAbs = draw(s, ranges.zig_angle_abs_rad);
  const zigSign = uniform01(s) < 0.5 ? -1 : 1;
  const zigFraction = draw(s, ranges.zig_fraction);
  const r = ranges.target_range0_m;
  const range0 =
    ranges.range_distribution === "log_uniform" ? logUniform(s, r.min, r.max) : draw(s, r);
  const bearing0 = uniform(s, 0, TWO_PI);
  const targetSpeed = draw(s, ranges.target_speed_mps);
  const targetCourse = uniform(s, 0, TWO_PI);
  const sigmas = ranges.noise_sigma_rad_values;
  const sigma = sigmas[uniformInt(s, sigmas.length)] ?? 0;
  const dropout = draw(s, ranges.dropout_fraction);
  return {
    window_s: f32(samples * dt),
    dt_s: f32(dt),
    ownship_speed_mps: f32(ownshipSpeed),
    ownship_course0_rad: f32Angle(course0),
    zig_angle_rad: f32(zigSign * zigAbs),
    zig_fraction: f32(zigFraction),
    target_range0_m: f32(range0),
    target_bearing0_rad: f32Angle(bearing0),
    target_speed_mps: f32(targetSpeed),
    target_course_rad: f32Angle(targetCourse),
    noise_sigma_rad: f32(sigma),
    dropout_fraction: f32(dropout),
  };
}

/** Truth positions (float64) for ownship and target at each sample. */
export interface Truth {
  samples: number;
  zigIndex: number;
  ownX: Float64Array;
  ownY: Float64Array;
  ownCourse: Float64Array;
  tgtX: Float64Array;
  tgtY: Float64Array;
}

/** Ownship two-leg motion and constant-velocity target motion. */
export function simulateTruth(p: ScenarioParameters): Truth {
  const samples = Math.round(p.window_s / p.dt_s);
  const zigIndex = Math.round(p.zig_fraction * samples);
  const tZig = zigIndex * p.dt_s;
  const c0 = p.ownship_course0_rad;
  const c1 = wrap2pi(c0 + p.zig_angle_rad);
  const v = p.ownship_speed_mps;
  const zx = v * Math.sin(c0) * tZig;
  const zy = v * Math.cos(c0) * tZig;
  const tx0 = p.target_range0_m * Math.sin(p.target_bearing0_rad);
  const ty0 = p.target_range0_m * Math.cos(p.target_bearing0_rad);
  const tvx = p.target_speed_mps * Math.sin(p.target_course_rad);
  const tvy = p.target_speed_mps * Math.cos(p.target_course_rad);
  const truth: Truth = {
    samples,
    zigIndex,
    ownX: new Float64Array(samples),
    ownY: new Float64Array(samples),
    ownCourse: new Float64Array(samples),
    tgtX: new Float64Array(samples),
    tgtY: new Float64Array(samples),
  };
  for (let i = 0; i < samples; i++) {
    const t = i * p.dt_s;
    if (i < zigIndex) {
      truth.ownX[i] = v * Math.sin(c0) * t;
      truth.ownY[i] = v * Math.cos(c0) * t;
      truth.ownCourse[i] = c0;
    } else {
      truth.ownX[i] = zx + v * Math.sin(c1) * (t - tZig);
      truth.ownY[i] = zy + v * Math.cos(c1) * (t - tZig);
      truth.ownCourse[i] = c1;
    }
    truth.tgtX[i] = tx0 + tvx * t;
    truth.tgtY[i] = ty0 + tvy * t;
  }
  return truth;
}

function ranges(truth: Truth): { mean: number; min: number } {
  let sum = 0;
  let min = Infinity;
  for (let i = 0; i < truth.samples; i++) {
    const r = Math.hypot(
      (truth.tgtX[i] ?? 0) - (truth.ownX[i] ?? 0),
      (truth.tgtY[i] ?? 0) - (truth.ownY[i] ?? 0),
    );
    sum += r;
    min = Math.min(min, r);
  }
  return { mean: sum / truth.samples, min };
}

/** Bearings with Gaussian noise and random dropouts. Draws noise and dropout for every sample. */
export function observe(s: RngState, p: ScenarioParameters, truth: Truth): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < truth.samples; i++) {
    const noise = gaussian(s) * p.noise_sigma_rad;
    const dropped = uniform01(s) < p.dropout_fraction;
    const b = bearingOf(
      (truth.tgtX[i] ?? 0) - (truth.ownX[i] ?? 0),
      (truth.tgtY[i] ?? 0) - (truth.ownY[i] ?? 0),
    );
    out.push({
      timestamp_s: f32(i * p.dt_s),
      bearing_rad: dropped ? 0 : f32Angle(b + noise),
      valid: !dropped,
    });
  }
  return out;
}

export interface GeneratedScenario {
  scenario: Scenario;
  redraws: number;
}

/** Generate scenario `index` of a dataset. Geometries closer than `min_range_m` are redrawn. */
export function generateScenario(
  datasetSeed: bigint,
  index: number,
  r: ParameterRanges,
): GeneratedScenario {
  const seed = deriveSeed(datasetSeed, index);
  const s = createRng(seed);
  for (let redraws = 0; redraws <= MAX_REDRAWS; redraws++) {
    const p = drawParameters(s, r);
    const truth = simulateTruth(p);
    const rg = ranges(truth);
    if (rg.min < r.min_range_m) continue;
    const observations = observe(s, p, truth);
    const own: PlatformState[] = [];
    const tgt: PlatformState[] = [];
    for (let i = 0; i < truth.samples; i++) {
      const t = f32(i * p.dt_s);
      own.push({
        timestamp_s: t,
        x_m: f32(truth.ownX[i] ?? 0),
        y_m: f32(truth.ownY[i] ?? 0),
        course_rad: f32Angle(truth.ownCourse[i] ?? 0),
        speed_mps: p.ownship_speed_mps,
      });
      tgt.push({
        timestamp_s: t,
        x_m: f32(truth.tgtX[i] ?? 0),
        y_m: f32(truth.tgtY[i] ?? 0),
        course_rad: p.target_course_rad,
        speed_mps: p.target_speed_mps,
      });
    }
    const scenario: Scenario = {
      record: "scenario",
      metadata: {
        seed: seed.toString(),
        index,
        parameters: p,
        samples: truth.samples,
        zig_index: truth.zigIndex,
        zig_time_s: f32(truth.zigIndex * p.dt_s),
        mean_range_m: f32(rg.mean),
        min_range_m: f32(rg.min),
      },
      ownship: { id: "ownship", states: own },
      target: { id: "target", states: tgt },
      observations,
    };
    return { scenario, redraws };
  }
  throw new Error(`scenario ${index}: no valid geometry after ${MAX_REDRAWS} redraws`);
}
