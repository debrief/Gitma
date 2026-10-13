// Scenario generation (SRD §2–3): two-leg ownship, constant-velocity target, noisy bearings.
// The zig is instantaneous, or a constant-rate turn when the ranges give a turn rate (spec 003 US6).
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

export const GENERATOR_VERSION = "0.2.0";
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
  // Drawn last, and only when the ranges ask for a turn, so ranges without one consume the PRNG
  // exactly as generator 0.1.0 did and reproduce its scenarios byte for byte.
  const turnRange = ranges.ownship_turn_rate_rad_s;
  const turn = turnRange == null ? {} : { ownship_turn_rate_rad_s: f32(draw(s, turnRange)) };
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
    ...turn,
  };
}

/** Truth positions (float64) for ownship and target at each sample. */
export interface Truth {
  samples: number;
  /** First sample on leg 2 (after the turn completes, when there is a turn). */
  zigIndex: number;
  /** First sample after the turn starts; null for an instantaneous zig. */
  turnStartIndex: number | null;
  ownX: Float64Array;
  ownY: Float64Array;
  ownCourse: Float64Array;
  tgtX: Float64Array;
  tgtY: Float64Array;
}

/**
 * Ownship on a constant-rate arc, `tau` seconds after a turn that starts at (x0, y0) on course
 * `c0`. `omega` is signed (rad/s, positive = clockwise, i.e. to starboard). Closed form: the centre
 * lies |v/ω| abeam on the turn side, and heading c = c0 + ωτ gives
 * x = x0 + (v/ω)(cos c0 − cos c), y = y0 + (v/ω)(sin c − sin c0).
 */
export function arcPosition(
  x0: number,
  y0: number,
  c0: number,
  v: number,
  omega: number,
  tau: number,
): { x: number; y: number; course: number } {
  const r = v / omega;
  const c = c0 + omega * tau;
  return {
    x: x0 + r * (Math.cos(c0) - Math.cos(c)),
    y: y0 + r * (Math.sin(c) - Math.sin(c0)),
    course: wrap2pi(c),
  };
}

/** Turn rate of a parameter set; 0 (absent) means an instantaneous zig. */
const turnRate = (p: ScenarioParameters): number => p.ownship_turn_rate_rad_s ?? 0;

/**
 * Ownship two-leg motion and constant-velocity target motion. The zig (or the start of the turn)
 * is at sample k = round(zig_fraction × samples). With a turn rate ω the course changes at ω
 * towards the zig side for |zig| / ω seconds; leg 2 starts where the arc ends. A turn that does
 * not complete inside the window gives zigIndex ≥ samples (the caller redraws).
 */
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
    turnStartIndex: null,
    ownX: new Float64Array(samples),
    ownY: new Float64Array(samples),
    ownCourse: new Float64Array(samples),
    tgtX: new Float64Array(samples),
    tgtY: new Float64Array(samples),
  };
  for (let i = 0; i < samples; i++) {
    const t = i * p.dt_s;
    truth.tgtX[i] = tx0 + tvx * t;
    truth.tgtY[i] = ty0 + tvy * t;
  }
  const rate = turnRate(p);
  if (!(rate > 0)) {
    // Instantaneous zig: generator 0.1.0, unchanged.
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
    }
    return truth;
  }
  // Rate-limited turn starting at tZig (sample zigIndex is still on course c0).
  const omega = (p.zig_angle_rad < 0 ? -1 : 1) * rate;
  const turnS = Math.abs(p.zig_angle_rad) / rate;
  const end = arcPosition(zx, zy, c0, v, omega, turnS);
  let leg2 = zigIndex + 1;
  while ((leg2 - zigIndex) * p.dt_s < turnS) leg2++;
  truth.turnStartIndex = zigIndex + 1;
  truth.zigIndex = leg2;
  for (let i = 0; i < samples; i++) {
    const t = i * p.dt_s;
    const tau = t - tZig;
    if (i <= zigIndex) {
      truth.ownX[i] = v * Math.sin(c0) * t;
      truth.ownY[i] = v * Math.cos(c0) * t;
      truth.ownCourse[i] = c0;
    } else if (i < leg2) {
      const a = arcPosition(zx, zy, c0, v, omega, tau);
      truth.ownX[i] = a.x;
      truth.ownY[i] = a.y;
      truth.ownCourse[i] = a.course;
    } else {
      truth.ownX[i] = end.x + v * Math.sin(c1) * (tau - turnS);
      truth.ownY[i] = end.y + v * Math.cos(c1) * (tau - turnS);
      truth.ownCourse[i] = c1;
    }
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

/**
 * Generate scenario `index` of a dataset. Geometries closer than `min_range_m`, and turns that do
 * not complete inside the window, are redrawn.
 */
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
    if (truth.turnStartIndex !== null && truth.zigIndex >= truth.samples) continue;
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
        ...(truth.turnStartIndex === null ? {} : { turn_start_index: truth.turnStartIndex }),
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
