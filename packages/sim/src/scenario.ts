// Scenario generation (SRD §2–3): two- or three-leg ownship, constant-velocity target, noisy
// bearings. The zig is instantaneous, or a constant-rate turn when the ranges give a turn rate
// (spec 003 US6). Generator 0.3.0 (spec 007) adds an optional second zig and the across-the-line-
// of-sight rule; ranges without them reproduce 0.2.0's scenarios byte for byte. Generator 0.4.0
// (spec 010, SRD Annex B §B.2) adds an optional target course change, drawn last; ranges without
// it reproduce 0.3.0's scenarios byte for byte. Generator 0.5.0 (spec 012, SRD Annex C §C.2) adds
// 0–3 target course changes and an optional speed change, drawn last; ranges without them
// reproduce 0.4.0's scenarios byte for byte.
// Pure functions: every output is determined by (datasetSeed, index, ranges).
import type {
  FloatRange,
  ManoeuvreKind,
  Observation,
  ParameterRanges,
  PlatformState,
  Scenario,
  ScenarioParameters,
  TargetManoeuvre,
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

export const GENERATOR_VERSION = "0.5.0";
const MAX_REDRAWS = 1000;

const draw = (s: RngState, r: FloatRange): number => uniform(s, r.min, r.max);

/** Draw one parameter set; every value float32-rounded so metadata describes the data exactly. */
export function drawParameters(
  s: RngState,
  ranges: ParameterRanges,
  count?: ManoeuvreCount,
): ScenarioParameters {
  return drawScenario(s, ranges, count).parameters;
}

/** Generator 0.5.0: how many target course changes, and whether there is a speed change. */
export interface ManoeuvreCount {
  courseChanges: number;
  speedChange: boolean;
}

/**
 * The manoeuvre count of a scenario (generator 0.5.0), drawn once from its own stream (scenario
 * seed, sub-index 1) so that redrawing a geometry that cannot fit the manoeuvres never changes
 * how many there are: the realised count distribution is the declared one.
 */
export function drawManoeuvreCount(scenarioSeed: bigint, ranges: ParameterRanges): ManoeuvreCount {
  const weights = ranges.target_course_change_count_weights ?? [1];
  const s = createRng(deriveSeed(scenarioSeed, 1));
  const u = uniform01(s);
  let courseChanges = weights.length - 1;
  let acc = 0;
  for (let k = 0; k < weights.length; k++) {
    acc += weights[k] ?? 0;
    if (u < acc) {
      courseChanges = k;
      break;
    }
  }
  return { courseChanges, speedChange: uniform01(s) < (ranges.target_speed_change_fraction ?? 0) };
}

/**
 * A parameter set and whether its window fits a target turn (always true when the ranges have no
 * target manoeuvre). A set that does not fit is redrawn, whether or not its target turns, so the
 * window distribution is the same for turning and held-course targets.
 */
function drawScenario(
  s: RngState,
  ranges: ParameterRanges,
  count?: ManoeuvreCount,
): { parameters: ScenarioParameters; fits: boolean } {
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
  const one = planTargetManoeuvre(s, ranges, planManoeuvres(s, ranges, base));
  if (!one.fits) return one;
  return planTargetManoeuvres(s, ranges, one.parameters, count);
}

/**
 * Generator 0.5.0 draws (SRD Annex C §C.2), after every 0.4.0 draw (the count is given, from
 * `drawManoeuvreCount`): for every possible course change its sign, size and rate, the speed change's sign, size and rate, the
 * speed change's place in the order, and one uniform per possible manoeuvre for the timing. All
 * are drawn for every scenario, so the PRNG is consumed alike whatever is used.
 *
 * Timing: manoeuvres never overlap. The first starts at least `target_manoeuvre_after_zig_s`
 * after the first sample on leg 2, each starts at least `target_manoeuvre_spacing_s` after the
 * previous one ends, and the last ends at least `target_manoeuvre_margin_s` before the window
 * ends. The slack is shared out uniformly (sorted uniforms). A window that cannot fit the drawn
 * manoeuvres, or a speed change that would leave `target_speed_mps` either way, does not fit.
 */
function planTargetManoeuvres(
  s: RngState,
  ranges: ParameterRanges,
  p: ScenarioParameters,
  count?: ManoeuvreCount,
): { parameters: ScenarioParameters; fits: boolean } {
  const weights = ranges.target_course_change_count_weights;
  if (weights == null) return { parameters: p, fits: true };
  if (count === undefined) throw new Error("generator 0.5.0 ranges need a manoeuvre count");
  const angleRange = ranges.target_manoeuvre_angle_abs_rad;
  const rateRange = ranges.target_turn_rate_rad_s;
  const after = ranges.target_manoeuvre_after_zig_s;
  const margin = ranges.target_manoeuvre_margin_s;
  const spacing = ranges.target_manoeuvre_spacing_s;
  const speedFraction = ranges.target_speed_change_fraction ?? 0;
  const dvRange = ranges.target_speed_change_abs_mps;
  const accRange = ranges.target_speed_change_rate_mps2;
  if (
    angleRange == null ||
    rateRange == null ||
    after == null ||
    margin == null ||
    spacing == null ||
    (speedFraction > 0 && (dvRange == null || accRange == null))
  )
    throw new Error(
      "target_course_change_count_weights needs target_manoeuvre_angle_abs_rad, " +
        "target_turn_rate_rad_s, target_manoeuvre_after_zig_s, target_manoeuvre_margin_s and " +
        "target_manoeuvre_spacing_s (and the speed-change ranges when there are speed changes)",
    );
  if (ranges.target_manoeuvre_fraction != null)
    throw new Error(
      "target_manoeuvre_fraction and target_course_change_count_weights are exclusive",
    );
  const maxCourse = weights.length - 1;
  const nCourse = count.courseChanges;
  const speedChange = count.speedChange;
  const courses: TargetManoeuvre[] = [];
  for (let k = 0; k < maxCourse; k++) {
    const sign = uniform01(s) < 0.5 ? -1 : 1;
    const change = f32(sign * draw(s, angleRange));
    const rate = f32(draw(s, rateRange));
    courses.push({ kind: "course", start_time_s: 0, change, rate });
  }
  let speed: TargetManoeuvre | null = null;
  let speedFits = true;
  if (dvRange != null && accRange != null) {
    const sign = uniform01(s) < 0.5 ? -1 : 1;
    const dv = draw(s, dvRange);
    const rate = f32(draw(s, accRange));
    const lo = ranges.target_speed_mps.min;
    const hi = ranges.target_speed_mps.max;
    const v = p.target_speed_mps;
    const inside = (d: number): boolean => v + d >= lo && v + d <= hi;
    const change = inside(sign * dv) ? sign * dv : inside(-sign * dv) ? -sign * dv : null;
    if (change === null) speedFits = !speedChange;
    else speed = { kind: "speed", start_time_s: 0, change: f32(change), rate };
  }
  const place = uniform01(s);
  const slack: number[] = [];
  for (let k = 0; k <= maxCourse; k++) slack.push(uniform01(s));
  if (!speedFits) return { parameters: p, fits: false };
  const plan = courses.slice(0, nCourse);
  if (speedChange && speed !== null)
    plan.splice(Math.min(plan.length, Math.floor(place * (plan.length + 1))), 0, speed);
  const dt = p.dt_s;
  const samples = Math.round(p.window_s / dt);
  const lo = simulateTruth(p).zigIndex + Math.ceil(after / dt);
  const hiEnd = samples - 1 - Math.ceil(margin / dt);
  const gap = Math.ceil(spacing / dt);
  const rows = plan.map((m) => turnRows(manoeuvreSeconds(m), dt));
  const total = rows.reduce((a, b) => a + b, 0) + Math.max(0, plan.length - 1) * gap;
  const free = hiEnd - lo - total;
  if (plan.length > 0 && free < 0) return { parameters: p, fits: false };
  const offsets = slack
    .slice(0, plan.length)
    .map((u) => Math.min(free, Math.floor(u * (free + 1))))
    .sort((a, b) => a - b);
  let used = 0;
  const target_manoeuvres = plan.map((m, j) => {
    const start = lo + (offsets[j] ?? 0) + used;
    used += (rows[j] ?? 0) + gap;
    return { ...m, start_time_s: f32(start * dt) };
  });
  return { parameters: { ...p, target_manoeuvres }, fits: true };
}

/** Duration of a manoeuvre (s): |change| / rate. */
export const manoeuvreSeconds = (m: TargetManoeuvre): number => Math.abs(m.change) / m.rate;

/**
 * Generator 0.4.0 draws, after every 0.3.0 draw so older ranges consume the PRNG unchanged: whether
 * the target turns, its signed course change, its turn rate and the turn's start sample. All four
 * are drawn for every scenario when the ranges have a manoeuvre fraction. The turn starts at a
 * whole sample, uniformly between `target_manoeuvre_after_zig_s` after the first sample on leg 2
 * and the last start that ends the turn `target_manoeuvre_margin_s` before the window ends. The
 * ownship's zigs are planned on the target's straight track, as an operator plans on the current
 * solution.
 */
function planTargetManoeuvre(
  s: RngState,
  ranges: ParameterRanges,
  p: ScenarioParameters,
): { parameters: ScenarioParameters; fits: boolean } {
  const fraction = ranges.target_manoeuvre_fraction;
  if (fraction == null) return { parameters: p, fits: true };
  const angleRange = ranges.target_manoeuvre_angle_abs_rad;
  const rateRange = ranges.target_turn_rate_rad_s;
  const after = ranges.target_manoeuvre_after_zig_s;
  const margin = ranges.target_manoeuvre_margin_s;
  if (angleRange == null || rateRange == null || after == null || margin == null)
    throw new Error(
      "target_manoeuvre_fraction needs target_manoeuvre_angle_abs_rad, target_turn_rate_rad_s, " +
        "target_manoeuvre_after_zig_s and target_manoeuvre_margin_s",
    );
  const turns = uniform01(s) < fraction;
  const angle = f32((uniform01(s) < 0.5 ? -1 : 1) * draw(s, angleRange));
  const rate = f32(draw(s, rateRange));
  const where = uniform01(s);
  const dt = p.dt_s;
  const samples = Math.round(p.window_s / dt);
  const zigIndex = simulateTruth(p).zigIndex;
  const lo = zigIndex + Math.ceil(after / dt);
  const hi = samples - 1 - Math.ceil(margin / dt) - turnRows(Math.abs(angle) / rate, dt);
  if (hi < lo) return { parameters: p, fits: false };
  const start = lo + Math.min(hi - lo, Math.floor(where * (hi - lo + 1)));
  if (!turns) return { parameters: p, fits: true };
  return {
    parameters: {
      ...p,
      target_manoeuvre_time_s: f32(start * dt),
      target_manoeuvre_angle_rad: angle,
      target_turn_rate_rad_s: rate,
    },
    fits: true,
  };
}

/** Samples from a turn's start sample to the first sample after it ends (as the ownship's legs). */
function turnRows(turnS: number, dt: number): number {
  let k = 1;
  while (k * dt < turnS) k++;
  return k;
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
  /** First sample after the target's turn starts; null when the target holds course. */
  manoeuvreStartIndex: number | null;
  /** First sample after the target's turn ends; null when the target holds course. */
  manoeuvreIndex: number | null;
  ownX: Float64Array;
  ownY: Float64Array;
  ownCourse: Float64Array;
  tgtX: Float64Array;
  tgtY: Float64Array;
  tgtCourse: Float64Array;
  tgtSpeed: Float64Array;
  /** Generator 0.5.0: each target manoeuvre's span; null under older ranges. */
  manoeuvres: { kind: ManoeuvreKind; startIndex: number; endIndex: number }[] | null;
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
    manoeuvreStartIndex: null,
    manoeuvreIndex: null,
    ownX: new Float64Array(samples),
    ownY: new Float64Array(samples),
    ownCourse: new Float64Array(samples),
    tgtX: new Float64Array(samples),
    tgtY: new Float64Array(samples),
    tgtCourse: new Float64Array(samples).fill(p.target_course_rad),
    tgtSpeed: new Float64Array(samples).fill(p.target_speed_mps),
    manoeuvres: null,
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
  return targetManoeuvres(p, targetManoeuvre(p, ownshipZig2(p, simulateTwoLegs(p))));
}

/**
 * The target's manoeuvres (generator 0.5.0), in order: straight at constant speed up to each
 * manoeuvre's start sample k, then for |change| / rate seconds either a constant-rate arc at
 * constant speed (`arcPosition`) or constant acceleration along the course, then straight from the
 * first sample after it ends. Each segment is closed-form from the state where it starts.
 */
function targetManoeuvres(p: ScenarioParameters, truth: Truth): Truth {
  const plan = p.target_manoeuvres;
  if (plan == null) return truth;
  truth.manoeuvres = [];
  const dt = p.dt_s;
  let x = truth.tgtX[0] ?? 0;
  let y = truth.tgtY[0] ?? 0;
  let c = p.target_course_rad;
  let v = p.target_speed_mps;
  let t0 = 0;
  let from = 0;
  const straight = (i: number): void => {
    const tau = i * dt - t0;
    truth.tgtX[i] = x + v * Math.sin(c) * tau;
    truth.tgtY[i] = y + v * Math.cos(c) * tau;
    truth.tgtCourse[i] = c;
    truth.tgtSpeed[i] = v;
  };
  for (const m of plan) {
    const k = Math.round(m.start_time_s / dt);
    if (k >= truth.samples) break;
    for (let i = from; i <= k; i++) straight(i);
    const ts = k * dt;
    const xs = x + v * Math.sin(c) * (ts - t0);
    const ys = y + v * Math.cos(c) * (ts - t0);
    const dur = manoeuvreSeconds(m);
    const end = k + turnRows(dur, dt);
    truth.manoeuvres.push({ kind: m.kind, startIndex: k + 1, endIndex: end });
    const sign = m.change < 0 ? -1 : 1;
    for (let i = k + 1; i < Math.min(end, truth.samples); i++) {
      const tau = (i - k) * dt;
      if (m.kind === "course") {
        const a = arcPosition(xs, ys, c, v, sign * m.rate, tau);
        truth.tgtX[i] = a.x;
        truth.tgtY[i] = a.y;
        truth.tgtCourse[i] = a.course;
        truth.tgtSpeed[i] = v;
      } else {
        const d = v * tau + 0.5 * sign * m.rate * tau * tau;
        truth.tgtX[i] = xs + Math.sin(c) * d;
        truth.tgtY[i] = ys + Math.cos(c) * d;
        truth.tgtCourse[i] = c;
        truth.tgtSpeed[i] = v + sign * m.rate * tau;
      }
    }
    // The state where the manoeuvre ends, exactly.
    if (m.kind === "course") {
      const a = arcPosition(xs, ys, c, v, sign * m.rate, dur);
      x = a.x;
      y = a.y;
      c = wrap2pi(c + m.change);
    } else {
      x = xs + Math.sin(c) * (v * dur + 0.5 * m.change * dur);
      y = ys + Math.cos(c) * (v * dur + 0.5 * m.change * dur);
      v = v + m.change;
    }
    t0 = ts + dur;
    from = end;
  }
  for (let i = from; i < truth.samples; i++) straight(i);
  const spans = truth.manoeuvres;
  const first = spans[0];
  const last = spans[spans.length - 1];
  truth.manoeuvreStartIndex = first === undefined ? null : first.startIndex;
  truth.manoeuvreIndex = last === undefined ? null : last.endIndex;
  return truth;
}

/**
 * The target's course change (generator 0.4.0): straight up to sample k = time / dt, then a
 * constant-rate arc at the target's speed (`arcPosition`, as the ownship's turns) of
 * |angle| / rate seconds, then straight on the new course from the first sample after the arc.
 */
function targetManoeuvre(p: ScenarioParameters, truth: Truth): Truth {
  const time = p.target_manoeuvre_time_s;
  const angle = p.target_manoeuvre_angle_rad;
  const rate = p.target_turn_rate_rad_s;
  if (time == null || angle == null || rate == null || !(rate > 0)) return truth;
  const dt = p.dt_s;
  const k = Math.round(time / dt);
  if (k >= truth.samples) return truth;
  const v = p.target_speed_mps;
  const c0 = p.target_course_rad;
  const c1 = wrap2pi(c0 + angle);
  const omega = (angle < 0 ? -1 : 1) * rate;
  const turnS = Math.abs(angle) / rate;
  const x0 = truth.tgtX[k] ?? 0;
  const y0 = truth.tgtY[k] ?? 0;
  const end = arcPosition(x0, y0, c0, v, omega, turnS);
  const leg = k + turnRows(turnS, dt);
  truth.manoeuvreStartIndex = k + 1;
  truth.manoeuvreIndex = leg;
  for (let i = k + 1; i < truth.samples; i++) {
    const tau = (i - k) * dt;
    if (i < leg) {
      const a = arcPosition(x0, y0, c0, v, omega, tau);
      truth.tgtX[i] = a.x;
      truth.tgtY[i] = a.y;
      truth.tgtCourse[i] = a.course;
    } else {
      truth.tgtX[i] = end.x + v * Math.sin(c1) * (tau - turnS);
      truth.tgtY[i] = end.y + v * Math.cos(c1) * (tau - turnS);
      truth.tgtCourse[i] = c1;
    }
  }
  return truth;
}

/** The second zig (generator 0.3.0) on a two-leg truth; unchanged when there is none. */
function ownshipZig2(p: ScenarioParameters, truth: Truth): Truth {
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
  const count =
    r.target_course_change_count_weights == null ? undefined : drawManoeuvreCount(seed, r);
  for (let redraws = 0; redraws <= MAX_REDRAWS; redraws++) {
    const { parameters: p, fits } = drawScenario(s, r, count);
    if (!fits) continue;
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
        course_rad: f32Angle(truth.tgtCourse[i] ?? p.target_course_rad),
        speed_mps: f32(truth.tgtSpeed[i] ?? p.target_speed_mps),
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
        ...(truth.manoeuvreIndex === null
          ? {}
          : {
              manoeuvre_start_index: truth.manoeuvreStartIndex ?? truth.manoeuvreIndex,
              manoeuvre_index: truth.manoeuvreIndex,
            }),
        ...(truth.manoeuvres === null
          ? {}
          : {
              manoeuvres: truth.manoeuvres.map((m) => ({
                kind: m.kind,
                start_index: m.startIndex,
                end_index: m.endIndex,
              })),
            }),
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
