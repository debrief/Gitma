// G0 checks added after the round-1 agent panel review (experiments/20261011-g0-r2/review.md):
// per-timestep recovery (the G1 baseline path), bearing residuals at float32 precision, and
// geometry checks that do not go through the solver.
import {
  bearingData,
  classicalPredict,
  type ImmParams,
  immPredict,
  solveBatch,
} from "@tma/classical";
import { angleDiff, createRng, degToRad, generateScenario, observe, simulateTruth } from "@tma/sim";
import type { GateCheck, ParameterRanges, Scenario, ScenarioParameters } from "@tma/types";
import { rowError } from "./errors.js";
import type { PredictionLookup } from "./evaluate.js";
import { G0_TOLERANCE } from "./gate.js";

const check = (name: string, pass: boolean, detail: string): GateCheck => ({
  name,
  result: pass ? "pass" : "fail",
  detail,
});

/** Rows this soon after the zig are barely conditioned; reported, not gated. */
export const PER_TIMESTEP_SETTLE_S = 60;

/**
 * Per-timestep classical recovery on noise-free data: every row converges, and every row at least
 * PER_TIMESTEP_SETTLE_S after the zig is within the SC-001 tolerances.
 */
export function checkPerTimestepRecovery(
  truth: Scenario[],
  perTimestep: Pick<PredictionLookup, "get">,
): GateCheck {
  let rows = 0;
  let gated = 0;
  let bad = 0;
  let nonConverged = 0;
  let worstEarly = 0;
  let worstGated = 0;
  for (const s of truth) {
    const p = perTimestep.get(s.metadata.index);
    if (p?.mode !== "per_timestep") {
      return check(
        "classical-per-timestep-recovers",
        false,
        `missing prediction ${String(s.metadata.index)}`,
      );
    }
    for (const row of p.rows) {
      rows++;
      if (!row.converged) {
        nonConverged++;
        continue;
      }
      const e = rowError(s, row);
      if (e.t_since_zig_s < PER_TIMESTEP_SETTLE_S) {
        worstEarly = Math.max(worstEarly, e.range_rel);
        continue;
      }
      gated++;
      worstGated = Math.max(worstGated, e.range_rel);
      if (
        !(e.range_rel <= G0_TOLERANCE.range_rel) ||
        !(e.course_deg <= G0_TOLERANCE.course_deg) ||
        !(e.speed_kt <= G0_TOLERANCE.speed_kt)
      )
        bad++;
    }
  }
  return check(
    "classical-per-timestep-recovers",
    truth.length > 0 && nonConverged === 0 && bad === 0,
    `${String(truth.length)} scenarios, ${String(rows)} rows: ${String(nonConverged)} non-converged; ` +
      `${String(gated - bad)}/${String(gated)} rows ≥ ${String(PER_TIMESTEP_SETTLE_S)} s after the zig within tolerance ` +
      `(worst range ${worstGated.toExponential(2)}); worst range in the first ${String(PER_TIMESTEP_SETTLE_S)} s ` +
      `${worstEarly.toExponential(2)} (reported, not gated)`,
  );
}

/** RMS bearing residual limit: a few float32 ulps of 2π (≈ 4.8e-7 rad). */
export const RESIDUAL_RMS_LIMIT_RAD = 1e-6;

/**
 * Final-mode solution's RMS bearing residual: a mismatch between the stored observations and the
 * constant-velocity fit (timing skew, ownship bias) shows here whatever the geometry. A frame error
 * shared by generator and solver does not; `checkIndependentGeometry` covers that.
 */
export function checkBearingResiduals(truth: Iterable<Scenario>): GateCheck {
  let n = 0;
  let bad = 0;
  let worst = 0;
  for (const s of truth) {
    const d = bearingData(s);
    const samples = s.metadata.samples;
    const sol = solveBatch(d, samples);
    const valid = d.valid.reduce((a, v) => a + v, 0);
    const rms = sol === null || valid === 0 ? Infinity : Math.sqrt(sol.cost / valid);
    worst = Math.max(worst, rms);
    if (!(rms <= RESIDUAL_RMS_LIMIT_RAD)) bad++;
    n++;
  }
  return check(
    "bearing-residuals-at-float32-precision",
    n > 0 && bad === 0,
    `${String(n - bad)}/${String(n)} final solutions with RMS bearing residual ≤ ${String(RESIDUAL_RMS_LIMIT_RAD)} rad; worst ${worst.toExponential(2)} rad`,
  );
}

const KNOWN: ScenarioParameters = {
  window_s: 600,
  dt_s: 10,
  ownship_speed_mps: 10,
  ownship_course0_rad: 0,
  zig_angle_rad: degToRad(60),
  zig_fraction: 0.5,
  target_range0_m: 1000,
  target_bearing0_rad: 0,
  target_speed_mps: 0,
  target_course_rad: 0,
  noise_sigma_rad: 0,
  dropout_fraction: 0,
};

/**
 * Rate-limited turn known answers (spec 003 US6): ownship north at 10 m/s turns ±60° at 1°/s from
 * t = 300 s at (0, 3000); stationary target at (5000, 0); arc radius r = v/ω.
 * - mid-turn (t = 330 s, sample 33): turned ±30° about the centre (±r, 3000), so ownship is at
 *   (±r(1 − cos 30°), 3000 + r sin 30°);
 * - leg 2 (t = 400 s, sample 40): the turn ended at t = 360 s at (±r(1 − cos 60°), 3000 + r sin 60°)
 *   on course ±60°, then 40 s straight.
 * Starboard (+) and port (−), so a sign error in the turn direction fails (G0 red team, 2026-10-13).
 * Literal Math.atan2 and trigonometry, not the shared bearingOf or arc helper.
 */
export function inTurnBearings(): { name: string; got: number; want: number }[] {
  const omega = Math.PI / 180;
  const r = 10 / omega;
  const out: { name: string; got: number; want: number }[] = [];
  for (const side of [1, -1]) {
    const p: ScenarioParameters = {
      ...KNOWN,
      zig_angle_rad: side * degToRad(60),
      target_bearing0_rad: Math.PI / 2,
      target_range0_m: 5000,
      ownship_turn_rate_rad_s: omega,
    };
    const obs = observe(createRng(1n), p, simulateTruth(p));
    const label = side > 0 ? "starboard" : "port";
    const midX = side * r * (1 - Math.cos(Math.PI / 6));
    const midY = 3000 + r * Math.sin(Math.PI / 6);
    out.push({
      name: `${label} mid-turn`,
      got: obs[33]?.bearing_rad ?? NaN,
      want: Math.atan2(5000 - midX, 0 - midY),
    });
    const c1 = side * (Math.PI / 3);
    const legX = side * r * (1 - Math.cos(Math.PI / 3)) + 10 * 40 * Math.sin(c1);
    const legY = 3000 + r * Math.sin(Math.PI / 3) + 10 * 40 * Math.cos(c1);
    out.push({
      name: `${label} leg 2`,
      got: obs[40]?.bearing_rad ?? NaN,
      want: Math.atan2(5000 - legX, 0 - legY),
    });
  }
  return out;
}

/**
 * Second-turn known answers (generator 0.3.0, spec 007; G0 red team round 1): as `inTurnBearings`'
 * first turn (+60° at 1°/s from t = 300 s, so leg 2 starts at t = 360 s from
 * p₁ = (r(1 − cos 60°), 3000 + r sin 60°) on course 60°), then 100 s of leg 2 to
 * p₂ = p₁ + 1000 (sin 60°, cos 60°) at t = 460 s and a second ±60° turn at 1°/s:
 * - mid-arc (t = 490 s, sample 49): heading 60° ± 30°, p = p₂ + (±r)(cos 60° − cos c, sin c − sin 60°);
 * - leg 3 (t = 560 s, sample 56): the arc ended at t = 520 s on course 60° ± 60°, then 40 s straight.
 * Both directions, so a second arc flown the wrong way, or leg 3 left on the leg-2 track, fails.
 */
export function secondTurnBearings(): { name: string; got: number; want: number }[] {
  const omega = Math.PI / 180;
  const r = 10 / omega;
  const c1 = Math.PI / 3;
  const p1x = r * (1 - Math.cos(c1));
  const p1y = 3000 + r * Math.sin(c1);
  const p2x = p1x + 1000 * Math.sin(c1);
  const p2y = p1y + 1000 * Math.cos(c1);
  const out: { name: string; got: number; want: number }[] = [];
  for (const side of [1, -1]) {
    const p: ScenarioParameters = {
      ...KNOWN,
      zig_angle_rad: degToRad(60),
      target_bearing0_rad: Math.PI / 2,
      target_range0_m: 5000,
      ownship_turn_rate_rad_s: omega,
      zig2_delay_s: 100,
      zig2_angle_rad: side * degToRad(60),
    };
    const obs = observe(createRng(1n), p, simulateTruth(p));
    const label = side > 0 ? "second turn to starboard" : "second turn to port";
    const c = c1 + side * (Math.PI / 6);
    const midX = p2x + side * r * (Math.cos(c1) - Math.cos(c));
    const midY = p2y + side * r * (Math.sin(c) - Math.sin(c1));
    out.push({
      name: `${label}, mid-arc`,
      got: obs[49]?.bearing_rad ?? NaN,
      want: Math.atan2(5000 - midX, 0 - midY),
    });
    const c2 = c1 + side * (Math.PI / 3);
    const endX = p2x + side * r * (Math.cos(c1) - Math.cos(c2));
    const endY = p2y + side * r * (Math.sin(c2) - Math.sin(c1));
    const legX = endX + 10 * 40 * Math.sin(c2);
    const legY = endY + 10 * 40 * Math.cos(c2);
    out.push({
      name: `${label}, leg 3`,
      got: obs[56]?.bearing_rad ?? NaN,
      want: Math.atan2(5000 - legX, 0 - legY),
    });
  }
  return out;
}

/** Wrapped angle difference in (−π, π]. */
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Kinematic consistency of one track (G0 panel rounds 1–2): each step lies between the full-step
 * arc chord and v·dt; the chord's heading lies between the stored courses at the step's ends
 * (equal to them on a leg); the course changes by at most ω·dt per step; and each rate-limited
 * turn's summed course change equals its stored angle. Returns the first failure.
 */
function trackFailure(
  states: Scenario["ownship"]["states"],
  v: number,
  dt: number,
  rate: number,
  turns: [number | null | undefined, number | null | undefined, number | null | undefined][],
  constantCourse = false,
): string | null {
  // The shortest a step at speed v can be: the chord of a full-step arc at ω (v·dt on a leg).
  const minStep = rate > 0 ? 2 * (v / rate) * Math.sin((rate * dt) / 2) : v * dt;
  for (let i = 1; i < states.length; i++) {
    const a = states[i - 1];
    const b = states[i];
    if (a === undefined || b === undefined) return `sample ${String(i)} missing`;
    const dx = b.x_m - a.x_m;
    const dy = b.y_m - a.y_m;
    const step = Math.hypot(dx, dy);
    if (step > v * dt + 0.05) return `sample ${String(i)}: step ${step.toFixed(3)} m > v·dt`;
    if (step < minStep - 0.05)
      return `sample ${String(i)}: step ${step.toFixed(3)} m < ${minStep.toFixed(3)} m (slower than the stored speed)`;
    const dc = wrapPi(b.course_rad - a.course_rad);
    if (rate > 0 && Math.abs(dc) > rate * dt + 1e-5)
      return `sample ${String(i)}: course changed ${dc.toFixed(5)} rad > ω·dt`;
    if (constantCourse && dc !== 0)
      return `sample ${String(i)}: course changed ${dc.toFixed(5)} rad on a held course`;
    // A step whose ends share a course lies on a straight leg: it is v·dt long, along that course
    // (G0 panel phase 3, geometry: the arc-chord minimum alone lets a leg run ~1% slow, and a held
    // course's direction was otherwise checked only through the solver).
    if (dc === 0 && step < v * dt - 0.05)
      return `sample ${String(i)}: straight step ${step.toFixed(3)} m < v·dt (slower than the stored speed)`;
    if ((rate > 0 || dc === 0) && step > 1) {
      // On a constant-speed path that turns one way during the step, the chord's heading lies
      // between the headings at its ends (equal to them on a straight leg).
      const off = wrapPi(Math.atan2(dx, dy) - a.course_rad);
      const lo = Math.min(0, dc) - 2e-4;
      const hi = Math.max(0, dc) + 2e-4;
      if (off < lo || off > hi)
        return `sample ${String(i)}: chord heading ${off.toExponential(2)} rad off the course, outside [0, ${dc.toExponential(2)}]`;
    }
  }
  // Each rate-limited turn's summed course change equals its stored signed angle, so a track that
  // turns 2π − |angle| the other way to the same course fails (G0 panel round 2, geometry).
  for (const [start, end, angle] of turns) {
    if (start == null || end == null || angle == null) continue;
    let sum = 0;
    for (let i = start; i <= end; i++) {
      const a = states[i - 1];
      const b = states[i];
      if (a === undefined || b === undefined)
        return `turn at sample ${String(start)}: samples missing`;
      const dc = wrapPi(b.course_rad - a.course_rad);
      sum += dc;
      // Every step that lies wholly on the arc turns by exactly ω·dt, so a turn flown at the wrong
      // rate, or indices shifted by a sample, fail (G0 panel phase 3, red team M3, M10, M11).
      if (i < end && rate > 0 && Math.abs(Math.abs(dc) - rate * dt) > 1e-5)
        return `turn at sample ${String(start)}: step ${String(i)} turned ${dc.toFixed(6)} rad, not ω·dt = ${(rate * dt).toFixed(6)}`;
    }
    if (Math.abs(sum - angle) > 1e-4)
      return `turn at sample ${String(start)}: course changed ${sum.toFixed(5)} rad, stored ${angle.toFixed(5)}`;
  }
  return null;
}

/**
 * Kinematic consistency of one scenario: the ownship track (its zigs), and from generator 0.4.0
 * the target track (constant speed; its one course change, if any, at the stored rate and angle;
 * otherwise a constant course). The stored courses are model inputs and truth, so a course that
 * disagrees with the positions fails here even when the solver, which uses positions only, is
 * unaffected. Returns the first failure.
 */
export function kinematicFailure(s: Scenario): string | null {
  const p = s.metadata.parameters;
  const m = s.metadata;
  const own = trackFailure(
    s.ownship.states,
    p.ownship_speed_mps,
    p.dt_s,
    p.ownship_turn_rate_rad_s ?? 0,
    [
      [m.turn_start_index, m.zig_index, p.zig_angle_rad],
      [m.turn2_start_index, m.zig2_index, p.zig2_angle_rad],
    ],
  );
  if (own !== null) return `ownship ${own}`;
  if (m.manoeuvres != null) {
    const tgt = targetManoeuvresFailure(s);
    return tgt === null ? null : `target ${tgt}`;
  }
  const turns = m.manoeuvre_index != null;
  const tgt = trackFailure(
    s.target.states,
    p.target_speed_mps,
    p.dt_s,
    turns ? (p.target_turn_rate_rad_s ?? 0) : 0,
    turns ? [[m.manoeuvre_start_index, m.manoeuvre_index, p.target_manoeuvre_angle_rad]] : [],
    !turns,
  );
  return tgt === null ? null : `target ${tgt}`;
}

/**
 * Kinematic consistency of a generator-0.5.0 target track (SRD Annex C §C.2), step by step:
 * - outside every manoeuvre, course and speed are constant, each step is v·dt long along the
 *   course;
 * - in a course change, speed is constant, every step wholly on the arc turns by ω·dt, each step
 *   lies between the full-step chord and v·dt with its chord heading between the end courses, and
 *   the summed course change equals the stored change;
 * - in a speed change, course is constant, every step wholly inside it changes speed by a·dt, each
 *   step is between the end speeds × dt along the course, and the summed speed change equals the
 *   stored change.
 * The spans must match the drawn manoeuvres in kind, order and length. Returns the first failure.
 */
export function targetManoeuvresFailure(s: Scenario): string | null {
  const p = s.metadata.parameters;
  const spans = s.metadata.manoeuvres ?? [];
  const plan = p.target_manoeuvres ?? [];
  const dt = p.dt_s;
  const st = s.target.states;
  if (spans.length !== plan.length)
    return `${String(spans.length)} manoeuvre spans for ${String(plan.length)} drawn manoeuvres`;
  for (let j = 0; j < plan.length; j++) {
    const m = plan[j];
    const sp = spans[j];
    if (m === undefined || sp === undefined) return "manoeuvre missing";
    if (m.kind !== sp.kind) return `manoeuvre ${String(j)}: span kind ${sp.kind}, drawn ${m.kind}`;
    const k = Math.round(m.start_time_s / dt);
    const dur = Math.abs(m.change) / m.rate;
    if (sp.start_index !== k + 1)
      return `manoeuvre ${String(j)}: starts after sample ${String(sp.start_index)}, drawn ${String(k + 1)}`;
    if (!((sp.end_index - k) * dt >= dur - 1e-6 && (sp.end_index - k - 1) * dt < dur - 1e-6))
      return `manoeuvre ${String(j)}: span ${String(sp.start_index)}–${String(sp.end_index)} does not fit its ${dur.toFixed(2)} s`;
    if (j > 0 && sp.start_index <= (spans[j - 1]?.end_index ?? 0))
      return `manoeuvre ${String(j)} overlaps the one before`;
  }
  const spanOf = (i: number): number =>
    spans.findIndex((x) => i >= x.start_index && i <= x.end_index);
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1];
    const b = st[i];
    if (a === undefined || b === undefined) return `sample ${String(i)} missing`;
    const dx = b.x_m - a.x_m;
    const dy = b.y_m - a.y_m;
    const step = Math.hypot(dx, dy);
    const dc = wrapPi(b.course_rad - a.course_rad);
    const dv = b.speed_mps - a.speed_mps;
    const heading = step > 1 ? wrapPi(Math.atan2(dx, dy) - a.course_rad) : 0;
    const j = spanOf(i);
    const sp = spans[j];
    const m = plan[j];
    if (sp === undefined || m === undefined) {
      if (dc !== 0 || dv !== 0)
        return `sample ${String(i)}: course or speed changed outside a manoeuvre`;
      if (Math.abs(step - a.speed_mps * dt) > 0.05)
        return `sample ${String(i)}: straight step ${step.toFixed(3)} m, not v·dt`;
      if (Math.abs(heading) > 2e-4) return `sample ${String(i)}: straight step off the course`;
      continue;
    }
    const interior = i < sp.end_index;
    if (m.kind === "course") {
      const v = a.speed_mps;
      if (dv !== 0) return `sample ${String(i)}: speed changed in a course change`;
      if (interior && Math.abs(Math.abs(dc) - m.rate * dt) > 1e-5)
        return `sample ${String(i)}: turned ${dc.toFixed(6)} rad, not ω·dt`;
      const minStep = 2 * (v / m.rate) * Math.sin((m.rate * dt) / 2);
      if (step > v * dt + 0.05 || step < minStep - 0.05)
        return `sample ${String(i)}: step ${step.toFixed(3)} m outside the arc's bounds`;
      if (heading < Math.min(0, dc) - 2e-4 || heading > Math.max(0, dc) + 2e-4)
        return `sample ${String(i)}: chord heading outside the turn`;
    } else {
      if (dc !== 0) return `sample ${String(i)}: course changed in a speed change`;
      if (interior && Math.abs(Math.abs(dv) - m.rate * dt) > 1e-4)
        return `sample ${String(i)}: speed changed ${dv.toFixed(5)} m/s, not a·dt`;
      const lo = Math.min(a.speed_mps, b.speed_mps) * dt;
      const hi = Math.max(a.speed_mps, b.speed_mps) * dt;
      if (step < lo - 0.05 || step > hi + 0.05)
        return `sample ${String(i)}: step ${step.toFixed(3)} m outside the end speeds' bounds`;
      if (Math.abs(heading) > 2e-4) return `sample ${String(i)}: speed-change step off the course`;
    }
  }
  for (let j = 0; j < spans.length; j++) {
    const sp = spans[j];
    const m = plan[j];
    if (sp === undefined || m === undefined) continue;
    const a = st[sp.start_index - 1];
    const b = st[sp.end_index];
    if (a === undefined || b === undefined) return `manoeuvre ${String(j)}: samples missing`;
    if (m.kind === "course") {
      let sum = 0;
      for (let i = sp.start_index; i <= sp.end_index; i++)
        sum += wrapPi((st[i]?.course_rad ?? 0) - (st[i - 1]?.course_rad ?? 0));
      if (Math.abs(sum - m.change) > 1e-4)
        return `manoeuvre ${String(j)}: course changed ${sum.toFixed(5)} rad, drawn ${m.change.toFixed(5)}`;
    } else if (Math.abs(b.speed_mps - a.speed_mps - m.change) > 1e-3)
      return `manoeuvre ${String(j)}: speed changed ${(b.speed_mps - a.speed_mps).toFixed(4)} m/s, drawn ${m.change.toFixed(4)}`;
  }
  return null;
}

/**
 * Generator-0.5.0 timing and bounds (SRD Annex C §C.2) against the ranges: the first manoeuvre
 * starts at least `target_manoeuvre_after_zig_s` after the zig, each at least
 * `target_manoeuvre_spacing_s` after the one before ends, the last ends at least
 * `target_manoeuvre_margin_s` before the window ends, and every stored target speed lies in
 * `target_speed_mps`. Returns the first failure.
 */
export function manoeuvreTimingFailure(s: Scenario, r: ParameterRanges): string | null {
  const m = s.metadata;
  const spans = m.manoeuvres;
  if (spans == null) return null;
  const dt = m.parameters.dt_s;
  const after = Math.ceil((r.target_manoeuvre_after_zig_s ?? 0) / dt);
  const gap = Math.ceil((r.target_manoeuvre_spacing_s ?? 0) / dt);
  const margin = Math.ceil((r.target_manoeuvre_margin_s ?? 0) / dt);
  for (let j = 0; j < spans.length; j++) {
    const sp = spans[j];
    if (sp === undefined) continue;
    const k = sp.start_index - 1;
    if (j === 0 && k < m.zig_index + after) return "first manoeuvre too soon after the zig";
    const prev = spans[j - 1];
    if (prev !== undefined && k - prev.end_index < gap - 1)
      return `manoeuvre ${String(j)} closer than the spacing to the one before`;
    if (j === spans.length - 1 && sp.end_index > m.samples - 1 - margin)
      return "last manoeuvre ends inside the margin";
  }
  const lo = r.target_speed_mps.min - 1e-3;
  const hi = r.target_speed_mps.max + 1e-3;
  if (s.target.states.some((x) => x.speed_mps < lo || x.speed_mps > hi))
    return "target speed outside target_speed_mps";
  return null;
}

/**
 * Generator-0.5.0 known answers (spec 012), with literal arithmetic. Ownship north at 10 m/s, its
 * zig late (t = 540 s); the target starts 5 km due east heading north at 5 m/s.
 * - Speed change: +5 m/s at 0.1 m/s² from t = 200 s at (5000, 1000). At t = 230 s it has run
 *   5·30 + ½·0.1·30² = 195 m; the change ends at t = 250 s after 375 m, then 10 m/s for 150 s, so
 *   at t = 400 s it is at (5000, 1000 + 375 + 1500).
 * - Two turns: +90° at 1°/s from t = 200 s (ends t = 290 s at (5000 + r, 1000 + r) heading east,
 *   r = 5/ω), 60 s east, then −90° at 1°/s from t = 350 s, ending at t = 440 s a further (r, r)
 *   on, heading north; at t = 500 s it is 300 m further north.
 */
export function targetManoeuvreBearings(): { name: string; got: number; want: number }[] {
  const omega = Math.PI / 180;
  const r = 5 / omega;
  const base: ScenarioParameters = {
    ...KNOWN,
    zig_fraction: 0.9,
    target_bearing0_rad: Math.PI / 2,
    target_range0_m: 5000,
    target_speed_mps: 5,
    target_course_rad: 0,
  };
  const speed: ScenarioParameters = {
    ...base,
    target_manoeuvres: [{ kind: "speed", start_time_s: 200, change: 5, rate: 0.1 }],
  };
  const turns: ScenarioParameters = {
    ...base,
    target_manoeuvres: [
      { kind: "course", start_time_s: 200, change: Math.PI / 2, rate: omega },
      { kind: "course", start_time_s: 350, change: -Math.PI / 2, rate: omega },
    ],
  };
  const sp = observe(createRng(1n), speed, simulateTruth(speed));
  const tu = observe(createRng(1n), turns, simulateTruth(turns));
  return [
    {
      name: "target speed change, during it",
      got: sp[23]?.bearing_rad ?? NaN,
      want: Math.atan2(5000, 1195 - 2300),
    },
    {
      name: "target speed change, after it",
      got: sp[40]?.bearing_rad ?? NaN,
      want: Math.atan2(5000, 2875 - 4000),
    },
    {
      name: "two target turns, after both",
      got: tu[50]?.bearing_rad ?? NaN,
      want: Math.atan2(5000 + 2 * r + 300, 1000 + 2 * r + 300 - 5000),
    },
  ];
}

/**
 * Target-turn known answers (generator 0.4.0, spec 010), with literal trigonometry. Ownship north
 * at 10 m/s, its zig late (t = 540 s); the target starts 5 km due east heading north at 5 m/s and
 * turns ±90° at 1°/s from t = 200 s at (5000, 1000), radius r = 5/ω:
 * - mid-turn (t = 250 s, sample 25): turned ±50° about the centre
 *   (5000 ± r, 1000), so the target is at (5000 ± r(1 − cos 50°), 1000 + r sin 50°);
 * - after the turn (t = 400 s, sample 40): the arc ended at t = 290 s at (5000 ± r, 1000 + r) on
 *   course ±90°, then 110 s straight.
 * Ownship at sample k is at (0, 100 k).
 */
export function targetTurnBearings(): { name: string; got: number; want: number }[] {
  const omega = Math.PI / 180;
  const r = 5 / omega;
  const out: { name: string; got: number; want: number }[] = [];
  for (const side of [1, -1]) {
    const p: ScenarioParameters = {
      ...KNOWN,
      zig_fraction: 0.9,
      target_bearing0_rad: Math.PI / 2,
      target_range0_m: 5000,
      target_speed_mps: 5,
      target_course_rad: 0,
      target_manoeuvre_time_s: 200,
      target_manoeuvre_angle_rad: side * (Math.PI / 2),
      target_turn_rate_rad_s: omega,
    };
    const obs = observe(createRng(1n), p, simulateTruth(p));
    const label = side > 0 ? "target turn to starboard" : "target turn to port";
    const a50 = (50 * Math.PI) / 180;
    const midX = 5000 + side * r * (1 - Math.cos(a50));
    const midY = 1000 + r * Math.sin(a50);
    out.push({
      name: `${label}, mid-turn`,
      got: obs[25]?.bearing_rad ?? NaN,
      want: Math.atan2(midX - 0, midY - 2500),
    });
    const legX = 5000 + side * r + side * 5 * 110;
    const legY = 1000 + r;
    out.push({
      name: `${label}, after it`,
      got: obs[40]?.bearing_rad ?? NaN,
      want: Math.atan2(legX - 0, legY - 4000),
    });
  }
  return out;
}

/**
 * Solver-independent geometry: hand-computed bearings (Math.atan2 with literal coordinates, not
 * the shared bearingOf) and, for every truth scenario, the t = 0 bearing and range against the
 * drawn parameters. Catches frame errors that the solver would share with the generator.
 */
export function checkIndependentGeometry(
  truth: Iterable<Scenario>,
  ranges?: ParameterRanges,
): GateCheck {
  const fails: string[] = [];
  const bearingsOf = (p: ScenarioParameters): number[] =>
    observe(createRng(1n), p, simulateTruth(p)).map((o) => o.bearing_rad);
  // Ownship east at 10 m/s, stationary target 1 km north: at t = 100 s ownship (1000, 0),
  // target (0, 1000): bearing 315°.
  const east = bearingsOf({ ...KNOWN, ownship_course0_rad: degToRad(90) })[10] ?? NaN;
  if (!(Math.abs(angleDiff(east, degToRad(315))) < 1e-6))
    fails.push(`315° case gave ${String(east)}`);
  // Ownship north, stationary target 5 km abeam to starboard: bearing atan2(5000, -10 t), drawing aft.
  const abeam = bearingsOf({ ...KNOWN, target_bearing0_rad: Math.PI / 2, target_range0_m: 5000 });
  const want = Math.atan2(5000, -10 * 200);
  if (!(Math.abs(angleDiff(abeam[20] ?? NaN, want)) < 1e-6)) fails.push("abeam case");
  if (!((abeam[20] ?? 0) > (abeam[0] ?? 0))) fails.push("abeam bearing does not draw aft");
  // Leg 2: ownship north at 10 m/s, zig +60° at t = 300 s, stationary target at (5000, 0). At
  // t = 400 s ownship is at (1000 sin 60°, 3000 + 1000 cos 60°) = (866.03, 3500).
  const leg2 = bearingsOf({
    ...KNOWN,
    target_bearing0_rad: Math.PI / 2,
    target_range0_m: 5000,
  })[40];
  const want2 = Math.atan2(
    5000 - 1000 * Math.sin(Math.PI / 3),
    -(3000 + 1000 * Math.cos(Math.PI / 3)),
  );
  if (!(Math.abs(angleDiff(leg2 ?? NaN, want2)) < 1e-6))
    fails.push(`leg-2 case gave ${String(leg2)}`);
  for (const c of inTurnBearings()) {
    if (!(Math.abs(angleDiff(c.got, c.want)) < 1e-6))
      fails.push(`${c.name} turn case gave ${String(c.got)}, want ${String(c.want)}`);
  }
  // Second zig (generator 0.3.0): as the leg-2 case, then a second instantaneous zig of −120°
  // 100 s into leg 2 (t = 400 s, at (866.03, 3500)) onto course 300°. At t = 500 s ownship is at
  // (866.03 − 1000 sin 60°, 3500 + 1000 cos 60°) = (0, 4000).
  const leg3 = bearingsOf({
    ...KNOWN,
    target_bearing0_rad: Math.PI / 2,
    target_range0_m: 5000,
    zig2_delay_s: 100,
    zig2_angle_rad: degToRad(-120),
  })[50];
  if (!(Math.abs(angleDiff(leg3 ?? NaN, Math.atan2(5000, -4000))) < 1e-6))
    fails.push(`leg-3 case gave ${String(leg3)}`);
  for (const c of [
    ...secondTurnBearings(),
    ...targetTurnBearings(),
    ...targetManoeuvreBearings(),
  ]) {
    if (!(Math.abs(angleDiff(c.got, c.want)) < 1e-6))
      fails.push(`${c.name} gave ${String(c.got)}, want ${String(c.want)}`);
  }
  let skipped = 0;
  let kinematic = 0;
  // Across the line of sight (zig_rule across_los): every turn of every scenario puts the target
  // on the other bow at an offset inside the drawn range, recomputed with literal atan2 from the
  // stored positions at the last sample before the turn and the course after it.
  const los = ranges?.zig_rule === "across_los" ? ranges.los_offset_rad : null;
  let turns = 0;
  let observed = 0;
  const rel = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  let n = 0;
  for (const s of truth) {
    const p = s.metadata.parameters;
    const o = s.ownship.states[0];
    const t = s.target.states[0];
    const z = s.observations[0];
    n++;
    if (o === undefined || t === undefined || z === undefined) {
      fails.push(`scenario ${String(s.metadata.index)}: empty`);
      continue;
    }
    const pz = s.metadata.parameters;
    if (
      Math.abs(pz.zig_angle_rad) > Math.PI + 1e-6 ||
      Math.abs(pz.zig2_angle_rad ?? 0) > Math.PI + 1e-6
    ) {
      if (fails.length < 5)
        fails.push(`scenario ${String(s.metadata.index)}: turn larger than 180°`);
    }
    const kin =
      kinematicFailure(s) ?? (ranges === undefined ? null : manoeuvreTimingFailure(s, ranges));
    if (kin !== null) {
      kinematic++;
      if (fails.length < 5) fails.push(`scenario ${String(s.metadata.index)}: ${kin}`);
    }
    if (los != null) {
      const m = s.metadata;
      const pairs: [number, number][] = [
        [(m.turn_start_index ?? m.zig_index + 1) - 1, m.zig_index],
      ];
      if (m.zig2_index != null)
        pairs.push([(m.turn2_start_index ?? m.zig2_index + 1) - 1, m.zig2_index]);
      for (const [k, after] of pairs) {
        const ok = s.ownship.states[k];
        // Zigs are planned on the target's straight track (generator 0.4.0), so after the target's
        // turn starts the rule is checked against that track, extrapolated from t = 0.
        const t0 = s.target.states[0];
        const straight =
          m.manoeuvre_start_index != null && k >= m.manoeuvre_start_index && t0 !== undefined
            ? {
                x_m: t0.x_m + p.target_speed_mps * Math.sin(p.target_course_rad) * k * p.dt_s,
                y_m: t0.y_m + p.target_speed_mps * Math.cos(p.target_course_rad) * k * p.dt_s,
              }
            : null;
        const tk = straight ?? s.target.states[k];
        const oa = s.ownship.states[after];
        if (ok === undefined || tk === undefined || oa === undefined) {
          skipped++;
          continue;
        }
        turns++;
        const brg = Math.atan2(tk.x_m - ok.x_m, tk.y_m - ok.y_m);
        // An instantaneous zig changes course at sample k itself: the old course is at k − 1.
        const instant = after === k;
        const oldCourse = (instant ? s.ownship.states[k - 1] : ok)?.course_rad ?? NaN;
        const before = rel(brg - oldCourse);
        const now = rel(brg - oa.course_rad);
        const off = Math.abs(now);
        const tol = 1e-4; // float32 storage of positions and courses
        if (Math.sign(now) === Math.sign(before) || off < los.min - tol || off > los.max + tol) {
          if (fails.length < 5)
            fails.push(
              `scenario ${String(m.index)}: turn at sample ${String(k)} not across the line of sight`,
            );
          else fails.push("…");
        }
      }
    }
    // Noise-free: every valid bearing equals atan2 of the stored positions at its sample, so
    // bearings drawn from another track (e.g. the target's unturned one, or one sample late)
    // fail (G0 panel phase 3, red team M1, M2).
    if (p.noise_sigma_rad === 0) {
      for (let i = 0; i < s.observations.length; i++) {
        const zi = s.observations[i];
        const oi = s.ownship.states[i];
        const ti = s.target.states[i];
        if (zi === undefined || oi === undefined || ti === undefined || !zi.valid) continue;
        observed++;
        const want = Math.atan2(ti.x_m - oi.x_m, ti.y_m - oi.y_m);
        if (!(Math.abs(angleDiff(zi.bearing_rad, want)) < 1e-5)) {
          if (fails.length < 5)
            fails.push(
              `scenario ${String(s.metadata.index)}: bearing at sample ${String(i)} is not the stored geometry's`,
            );
          else fails.push("…");
          break;
        }
      }
    }
    const b = Math.atan2(t.x_m - o.x_m, t.y_m - o.y_m);
    const r = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
    if (
      !(Math.abs(angleDiff(b, p.target_bearing0_rad)) < 1e-5) ||
      !(Math.abs(r / p.target_range0_m - 1) < 1e-5) ||
      (z.valid && !(Math.abs(angleDiff(z.bearing_rad, b)) < 1e-5))
    ) {
      if (fails.length < 5) fails.push(`scenario ${String(s.metadata.index)}: t = 0 geometry`);
      else fails.push("…");
    }
  }
  return check(
    "independent-geometry",
    fails.length === 0 && skipped === 0,
    fails.length === 0 && skipped === 0
      ? `hand-computed 315°, abeam, leg-2, turn (starboard and port, mid-turn and leg 2), leg-3, second-turn (both directions, mid-arc and leg 3) and target-turn (both directions, mid-turn and after it) cases match; t = 0 bearing and range match the drawn parameters, and ownship and target kinematics (arc chord ≤ step ≤ v·dt, chord heading between the stored courses, turn ≤ ω·dt per step, summed turn = stored angle, |turn| ≤ 180°, target course constant unless it turns, every arc step = ω·dt) hold, and ${String(observed)} noise-free bearings equal atan2 of the stored positions, on ${String(n)} scenarios` +
          (los != null
            ? `; ${String(turns)} turns put the target on the other bow inside the drawn offset range`
            : "")
      : [
          ...fails.slice(0, 6),
          ...(skipped > 0 ? [`${String(skipped)} turns could not be checked`] : []),
          ...(kinematic > 0 ? [`${String(kinematic)} scenarios fail kinematics`] : []),
        ].join("; "),
  );
}

/**
 * The part of a scenario that batch least squares can fit (generator 0.4.0): up to and including
 * the last sample before the target's turn starts. The constant-velocity solver cannot fit a turn,
 * so G0's classical checks run on this; it keeps at least `target_manoeuvre_after_zig_s` of leg 2.
 * Scenarios whose target holds course are returned unchanged.
 */
export function beforeManoeuvre(s: Scenario): Scenario {
  const m = s.metadata;
  if (m.manoeuvre_start_index == null) return s;
  const n = m.manoeuvre_start_index;
  const metadata = { ...m, samples: n };
  delete metadata.manoeuvre_start_index;
  delete metadata.manoeuvre_index;
  delete metadata.manoeuvres;
  if (m.zig2_index != null && m.zig2_index >= n) {
    delete metadata.zig2_index;
    delete metadata.turn2_start_index;
  }
  return {
    ...s,
    metadata,
    ownship: { ...s.ownship, states: s.ownship.states.slice(0, n) },
    target: { ...s.target, states: s.target.states.slice(0, n) },
    observations: s.observations.slice(0, n),
  };
}

/** The ranges give the target manoeuvres (generator 0.4.0's one turn, or 0.5.0's). */
export const hasTargetManoeuvre = (r: ParameterRanges): boolean =>
  r.target_manoeuvre_fraction != null || r.target_course_change_count_weights != null;

/** IMM settings G0 checks the tracker with (not a tuning: G4's are chosen on validation). */
export const G0_IMM: ImmParams = {
  sigmaCv: 0.001,
  sigmaCt: 0.01,
  sigmaOmega: 0.001,
  switchPerS: 0.001,
};

/**
 * The gated reference tracker on noise-free data (spec 010, SRD Annex B §B.3):
 * - on every given scenario, every IMM row from PER_TIMESTEP_SETTLE_S after the zig to the last
 *   sample before the target's turn (or the end) is within the SC-001 tolerances;
 * - after a target turn followed by an ownship zig (hand-built: 90° at 1°/s, both directions), the
 *   IMM is within 0.5% range over the last ten minutes. This shows the implementation tracks a
 *   turn; it does not show the tracker always re-converges (the variants below are reported);
 * - reported, not gated: its median range error five minutes after the turn on the given
 *   scenarios (re-convergence there depends on an ownship manoeuvre after the turn).
 * Not applicable when `ranges` has no target manoeuvre: with an instantaneous zig (iteration 1)
 * the batch fit the tracker starts from is nearly unobservable, and it settles more slowly.
 */
export function checkTrackerNoiseFree(truth: Scenario[], ranges?: ParameterRanges): GateCheck {
  if (ranges !== undefined && !hasTargetManoeuvre(ranges))
    return check(
      "tracker-noise-free",
      true,
      "not applicable: the ranges have no target manoeuvre (generator 0.4.0 and later checks only)",
    );
  let gated = 0;
  let bad = 0;
  let worstPre = 0;
  const post: number[] = [];
  for (const s of truth) {
    const m = s.metadata;
    const p = immPredict(s, G0_IMM);
    const first = m.zig_index + 1;
    const to = m.manoeuvre_start_index ?? m.samples;
    for (let i = first; i < m.samples; i++) {
      const row = p.rows[i - first];
      if (row === undefined) {
        bad++;
        continue;
      }
      const e = rowError(s, row);
      if (m.manoeuvre_index != null && i === m.manoeuvre_index + 30)
        post.push(row.converged ? e.range_rel : Infinity);
      if (i >= to || e.t_since_zig_s < PER_TIMESTEP_SETTLE_S) continue;
      gated++;
      worstPre = Math.max(worstPre, row.converged ? e.range_rel : Infinity);
      if (
        !row.converged ||
        !(e.range_rel <= G0_TOLERANCE.range_rel) ||
        !(e.course_deg <= G0_TOLERANCE.course_deg) ||
        !(e.speed_kt <= G0_TOLERANCE.speed_kt)
      )
        bad++;
    }
  }
  const known = [1, -1].map((side) => reconvergenceError(side));
  const knownOk = known.every((k) => k <= 5e-3);
  // Reported, not gated (G0 panel phase 3, numerics): the same geometry over the generator's
  // angles and rates. One favourable case and one setting show the code is right, not that the
  // tracker always re-converges.
  const variants: number[] = [];
  for (const side of [1, -1])
    for (const angle of [30, 60, 90, 120])
      for (const rate of [0.5, 1, 3]) variants.push(reconvergenceError(side, angle, rate));
  const within = variants.filter((k) => k <= 5e-3).length;
  post.sort((a, b) => a - b);
  const median = post[Math.floor(post.length / 2)] ?? NaN;
  // Gated loosely (G0 panel phase 3, red team): bearings or indices wrong after the turn raise it
  // by an order of magnitude or more.
  const postOk = post.length === 0 || median <= TRACKER_POST_TURN_LIMIT;
  return check(
    "tracker-noise-free",
    truth.length > 0 && bad === 0 && knownOk && postOk,
    `IMM (σ_cv ${String(G0_IMM.sigmaCv)}, σ_ct ${String(G0_IMM.sigmaCt)}, σ_ω ${String(G0_IMM.sigmaOmega)}, switch ${String(G0_IMM.switchPerS)}/s): ` +
      `${String(gated - bad)}/${String(gated)} rows from zig + ${String(PER_TIMESTEP_SETTLE_S)} s to the target's turn within tolerance (worst range ${worstPre.toExponential(2)}); ` +
      `after a hand-built target turn and ownship zig, worst range over the last 10 min ${known.map((k) => k.toExponential(2)).join(" (starboard), ")} (port), limit 5e-3; ` +
      `reported, not gated: the same case at 30–120° and 0.5–3°/s, both sides, ${String(within)}/${String(variants.length)} within 5e-3 (worst ${Math.max(...variants).toExponential(2)}); ` +
      `median range error at manoeuvre + 300 s ${median.toExponential(2)} on ${String(post.length)} turning scenarios (limit ${String(TRACKER_POST_TURN_LIMIT)})`,
  );
}

/** Limit on the IMM's noise-free median range error at manoeuvre + 300 s (observed 2.4e-3). */
export const TRACKER_POST_TURN_LIMIT = 1e-2;

/** IMM settings for the noisy check: no CV process noise, rare switching (a straight-leg tuning). */
export const G0_IMM_STRAIGHT: ImmParams = {
  sigmaCv: 0,
  sigmaCt: 0.01,
  sigmaOmega: 0.001,
  switchPerS: 1e-5,
};
/** The IMM's median may be at most this multiple of per-timestep batch least squares'. */
export const TRACKER_NOISY_RATIO = 1.25;
const NOISY_SEED = 20261028n;
const NOISY_SCENARIOS = 200;

/**
 * The tracker under noise (G0 panel phase 3, red team: a mis-scaled measurement variance is
 * invisible on noise-free data). From the dataset's ranges at σ = 1° (fixed seed, regenerated, not
 * a split of the dataset), at the last sample before each target's turn (or the end), the
 * straight-leg IMM's median range error must be within `TRACKER_NOISY_RATIO` × the per-timestep
 * batch solver's: on a constant-velocity stretch both should reach about the same accuracy.
 */
export function checkTrackerNoisy(ranges: ParameterRanges): GateCheck {
  const name = "tracker-noisy-sanity";
  if (!hasTargetManoeuvre(ranges))
    return check(
      name,
      true,
      "not applicable: the ranges have no target manoeuvre (generator 0.4.0 and later checks only)",
    );
  const r: ParameterRanges = {
    ...ranges,
    noise_sigma_rad_values: [degToRad(1)],
    dropout_fraction: { min: 0, max: 0 },
  };
  const imm: number[] = [];
  const lsq: number[] = [];
  for (let i = 0; i < NOISY_SCENARIOS; i++) {
    const s = generateScenario(NOISY_SEED, i, r).scenario;
    const m = s.metadata;
    const k = (m.manoeuvre_start_index ?? m.samples) - 1;
    const first = m.zig_index + 1;
    if (k < first) continue;
    const a = immPredict(s, G0_IMM_STRAIGHT).rows[k - first];
    const b = classicalPredict(s, "per_timestep").rows[k - first];
    if (a === undefined || b === undefined) continue;
    imm.push(a.converged ? rowError(s, a).range_rel : Infinity);
    lsq.push(b.converged ? rowError(s, b).range_rel : Infinity);
  }
  const med = (v: number[]): number =>
    [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? NaN;
  const ratio = med(imm) / med(lsq);
  return check(
    name,
    imm.length > 0 && ratio <= TRACKER_NOISY_RATIO,
    `σ = 1°, ${String(imm.length)} regenerated scenarios (seed ${String(NOISY_SEED)}), last sample before the target's turn: IMM (σ_cv ${String(G0_IMM_STRAIGHT.sigmaCv)}, σ_ct ${String(G0_IMM_STRAIGHT.sigmaCt)}, σ_ω ${String(G0_IMM_STRAIGHT.sigmaOmega)}, switch ${String(G0_IMM_STRAIGHT.switchPerS)}/s) median range error ${med(imm).toFixed(4)}, per-timestep batch least squares ${med(lsq).toFixed(4)}; ratio ${ratio.toFixed(3)}, limit ${String(TRACKER_NOISY_RATIO)}`,
  );
}

/** Worst range error of the IMM over the last 10 min of the hand-built re-convergence case. */
function reconvergenceError(side: number, angleDeg = 90, rateDegS = 1): number {
  const p: ScenarioParameters = {
    window_s: 2400,
    dt_s: 10,
    ownship_speed_mps: 5,
    ownship_course0_rad: 0,
    zig_angle_rad: degToRad(90),
    zig_fraction: 0.25,
    ownship_turn_rate_rad_s: degToRad(1),
    target_range0_m: 8000,
    target_bearing0_rad: degToRad(45),
    target_speed_mps: 4,
    target_course_rad: degToRad(270),
    noise_sigma_rad: 0,
    dropout_fraction: 0,
    zig2_delay_s: 600,
    zig2_angle_rad: degToRad(-90),
    target_manoeuvre_time_s: 900,
    target_manoeuvre_angle_rad: side * degToRad(angleDeg),
    target_turn_rate_rad_s: degToRad(rateDegS),
  };
  const tr = simulateTruth(p);
  const states = (x: Float64Array, y: Float64Array, c: Float64Array, v: number) =>
    Array.from({ length: tr.samples }, (_, i) => ({
      timestamp_s: i * 10,
      x_m: x[i] ?? 0,
      y_m: y[i] ?? 0,
      course_rad: c[i] ?? 0,
      speed_mps: v,
    }));
  const s: Scenario = {
    record: "scenario",
    metadata: {
      seed: "0",
      index: 0,
      parameters: p,
      samples: tr.samples,
      zig_index: tr.zigIndex,
      zig_time_s: tr.zigIndex * 10,
      mean_range_m: 0,
      min_range_m: 0,
    },
    ownship: { id: "ownship", states: states(tr.ownX, tr.ownY, tr.ownCourse, 5) },
    target: { id: "target", states: states(tr.tgtX, tr.tgtY, tr.tgtCourse, 4) },
    observations: observe(createRng(1n), p, tr),
  };
  const rows = immPredict(s, G0_IMM).rows;
  const first = tr.zigIndex + 1;
  let worst = 0;
  for (let i = tr.samples - 60; i < tr.samples; i++) {
    const r = rows[i - first];
    if (r === undefined || !r.converged) return Infinity;
    worst = Math.max(worst, rowError(s, r).range_rel);
  }
  return worst;
}
