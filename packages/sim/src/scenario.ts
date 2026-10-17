// Scenario generation (SRD §2–3): two- or three-leg ownship, constant-velocity target, noisy
// bearings. The zig is instantaneous, or a constant-rate turn when the ranges give a turn rate
// (spec 003 US6). Generator 0.3.0 (spec 007) adds an optional second zig and the across-the-line-
// of-sight rule; ranges without them reproduce 0.2.0's scenarios byte for byte.
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

export const GENERATOR_VERSION = "0.3.0";
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
  const base: ScenarioParameters = {
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
  return planManoeuvres(s, ranges, base);
}

/** Angle in (−π, π]. */
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The across-the-line-of-sight turn from course `course` at (ox, oy) with the target at (tx, ty):
 * the new course puts the target on the other bow at angle off `offset`, by the shorter turn.
 */
export function acrossLosTurn(
  ox: number,
  oy: number,
  course: number,
  tx: number,
  ty: number,
  offset: number,
): number {
  const brg = bearingOf(tx - ox, ty - oy);
  const rel = wrapPi(brg - course);
  const side = rel < 0 ? -1 : 1;
  return wrapPi(brg + side * offset - course);
}

/**
 * Generator 0.3.0 draws, after every 0.2.0 draw so older ranges consume the PRNG unchanged: the
 * across-LOS offsets (zig_rule across_los) and the second zig (zig2_delay_s). Across-LOS angles
 * depend on the geometry at each turn's start, so they are computed from the simulated truth.
 */
function planManoeuvres(
  s: RngState,
  ranges: ParameterRanges,
  base: ScenarioParameters,
): ScenarioParameters {
  const across = ranges.zig_rule === "across_los";
  const delayRange = ranges.zig2_delay_s;
  if (!across && delayRange == null) return base;
  const los = ranges.los_offset_rad;
  if (across && los == null) throw new Error("zig_rule across_los needs los_offset_rad");
  const offset1 = across && los != null ? draw(s, los) : 0;
  const delay = delayRange == null ? null : f32(draw(s, delayRange));
  let zig2Drawn = 0;
  if (delay !== null) {
    if (across && los != null) zig2Drawn = draw(s, los);
    else {
      const abs = draw(s, ranges.zig_angle_abs_rad);
      zig2Drawn = (uniform01(s) < 0.5 ? -1 : 1) * abs;
    }
  }
  let p = base;
  if (across) {
    const k = Math.round(p.zig_fraction * Math.round(p.window_s / p.dt_s));
    const t = k * p.dt_s;
    const c0 = p.ownship_course0_rad;
    const v = p.ownship_speed_mps;
    const tg = targetAt(p, t);
    p = {
      ...p,
      zig_angle_rad: f32(
        acrossLosTurn(v * Math.sin(c0) * t, v * Math.cos(c0) * t, c0, tg.x, tg.y, offset1),
      ),
    };
  }
  if (delay === null) return p;
  let zig2 = zig2Drawn;
  if (across) {
    // Geometry at the second turn's start, on the two-leg path (unchanged up to that sample).
    const two = simulateTruth(p);
    const k2 = two.zigIndex + Math.round(delay / p.dt_s);
    if (k2 < two.samples) {
      const tg = targetAt(p, k2 * p.dt_s);
      zig2 = acrossLosTurn(
        two.ownX[k2] ?? 0,
        two.ownY[k2] ?? 0,
        two.ownCourse[k2] ?? 0,
        tg.x,
        tg.y,
        zig2Drawn,
      );
    }
  }
  return { ...p, zig2_delay_s: delay, zig2_angle_rad: f32(zig2) };
}

/** Target position at time t (constant velocity from its start). */
function targetAt(p: ScenarioParameters, t: number): { x: number; y: number } {
  return {
    x:
      p.target_range0_m * Math.sin(p.target_bearing0_rad) +
      p.target_speed_mps * Math.sin(p.target_course_rad) * t,
    y:
      p.target_range0_m * Math.cos(p.target_bearing0_rad) +
      p.target_speed_mps * Math.cos(p.target_course_rad) * t,
  };
}

/** Truth positions (float64) for ownship and target at each sample. */
export interface Truth {
  samples: number;
  /** First sample on leg 2 (after the turn completes, when there is a turn). */
  zigIndex: number;
  /** First sample after the turn starts; null for an instantaneous zig. */
  turnStartIndex: number | null;
  /** First sample on leg 3 (second zig); null with one zig. */
  zig2Index: number | null;
  /** First sample after the second turn starts; null with one zig or an instantaneous zig. */
  turn2StartIndex: number | null;
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
 * Ownship two-leg motion (generator 0.2.0, unchanged) and constant-velocity target motion. The zig (or the start of the turn)
 * is at sample k = round(zig_fraction × samples). With a turn rate ω the course changes at ω
 * towards the zig side for |zig| / ω seconds; leg 2 starts where the arc ends. A turn that does
 * not complete inside the window gives zigIndex ≥ samples (the caller redraws).
 */
function simulateTwoLegs(p: ScenarioParameters): Truth {
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
    zig2Index: null,
    turn2StartIndex: null,
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

/**
 * Ownship motion with an optional second zig (generator 0.3.0): the two-leg path up to the
 * second turn's start, sample k2 = zig_index + round(zig2_delay_s / dt), then the same
 * conventions as the first zig (instantaneous at k2, or an arc at the same turn rate with leg 3
 * from the first sample after it ends). A second turn that does not complete inside the window
 * gives zig2Index ≥ samples (the caller redraws).
 */
export function simulateTruth(p: ScenarioParameters): Truth {
  const truth = simulateTwoLegs(p);
  const zig2 = p.zig2_angle_rad;
  const delay = p.zig2_delay_s;
  if (zig2 == null || delay == null) return truth;
  const dt = p.dt_s;
  const v = p.ownship_speed_mps;
  const k2 = truth.zigIndex + Math.round(delay / dt);
  truth.zig2Index = k2;
  if (k2 >= truth.samples) return truth;
  const t2 = k2 * dt;
  const x2 = truth.ownX[k2] ?? 0;
  const y2 = truth.ownY[k2] ?? 0;
  const c1 = truth.ownCourse[k2] ?? 0;
  const c2 = wrap2pi(c1 + zig2);
  const rate = turnRate(p);
  if (!(rate > 0)) {
    for (let i = k2; i < truth.samples; i++) {
      const tau = i * dt - t2;
      truth.ownX[i] = x2 + v * Math.sin(c2) * tau;
      truth.ownY[i] = y2 + v * Math.cos(c2) * tau;
      truth.ownCourse[i] = c2;
    }
    return truth;
  }
  const omega = (zig2 < 0 ? -1 : 1) * rate;
  const turnS = Math.abs(zig2) / rate;
  const end = arcPosition(x2, y2, c1, v, omega, turnS);
  let leg3 = k2 + 1;
  while ((leg3 - k2) * dt < turnS) leg3++;
  truth.turn2StartIndex = k2 + 1;
  truth.zig2Index = leg3;
  for (let i = k2 + 1; i < truth.samples; i++) {
    const tau = i * dt - t2;
    if (i < leg3) {
      const a = arcPosition(x2, y2, c1, v, omega, tau);
      truth.ownX[i] = a.x;
      truth.ownY[i] = a.y;
      truth.ownCourse[i] = a.course;
    } else {
      truth.ownX[i] = end.x + v * Math.sin(c2) * (tau - turnS);
      truth.ownY[i] = end.y + v * Math.cos(c2) * (tau - turnS);
      truth.ownCourse[i] = c2;
    }
  }
  return truth;
}

export interface GeneratedScenario {
  scenario: Scenario;
  redraws: number;
}

/**
 * Generate scenario `index` of a dataset. Geometries closer than `min_range_m`, and turns (first
 * or second) that do not complete inside the window, are redrawn.
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
    if (truth.zig2Index !== null && truth.zig2Index >= truth.samples) continue;
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
        ...(truth.zig2Index === null ? {} : { zig2_index: truth.zig2Index }),
        ...(truth.turn2StartIndex === null ? {} : { turn2_start_index: truth.turn2StartIndex }),
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
