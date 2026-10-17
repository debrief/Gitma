// G0 checks added after the round-1 agent panel review (experiments/20261011-g0-r2/review.md):
// per-timestep recovery (the G1 baseline path), bearing residuals at float32 precision, and
// geometry checks that do not go through the solver.
import { bearingData, solveBatch } from "@tma/classical";
import { angleDiff, createRng, degToRad, observe, simulateTruth } from "@tma/sim";
import type {
  GateCheck,
  ParameterRanges,
  Prediction,
  Scenario,
  ScenarioParameters,
} from "@tma/types";
import { rowError } from "./errors.js";
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
  perTimestep: Map<number, Prediction>,
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
 * Kinematic consistency of one scenario's ownship track (G0 red team round 1): each step is at
 * most v·dt; the chord's heading lies between the stored courses at the step's ends (equal to
 * them on a leg); and the course changes by at most ω·dt per step (rate-limited turns).
 * The stored course is a model input, so a course that disagrees with the positions fails here
 * even when the solver, which uses positions only, is unaffected. Returns the first failure.
 */
export function kinematicFailure(s: Scenario): string | null {
  const p = s.metadata.parameters;
  const v = p.ownship_speed_mps;
  const dt = p.dt_s;
  const rate = p.ownship_turn_rate_rad_s ?? 0;
  const own = s.ownship.states;
  for (let i = 1; i < own.length; i++) {
    const a = own[i - 1];
    const b = own[i];
    if (a === undefined || b === undefined) return `sample ${String(i)} missing`;
    const dx = b.x_m - a.x_m;
    const dy = b.y_m - a.y_m;
    const step = Math.hypot(dx, dy);
    if (step > v * dt + 0.05) return `sample ${String(i)}: step ${step.toFixed(3)} m > v·dt`;
    const dc = wrapPi(b.course_rad - a.course_rad);
    if (rate > 0 && Math.abs(dc) > rate * dt + 1e-5)
      return `sample ${String(i)}: course changed ${dc.toFixed(5)} rad > ω·dt`;
    if (rate > 0 && step > 1) {
      // On a constant-speed path that turns one way during the step, the chord's heading lies
      // between the headings at its ends (equal to them on a straight leg).
      const off = wrapPi(Math.atan2(dx, dy) - a.course_rad);
      const lo = Math.min(0, dc) - 2e-4;
      const hi = Math.max(0, dc) + 2e-4;
      if (off < lo || off > hi)
        return `sample ${String(i)}: chord heading ${off.toExponential(2)} rad off the course, outside [0, ${dc.toExponential(2)}]`;
    }
  }
  return null;
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
  for (const c of secondTurnBearings()) {
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
    const kin = kinematicFailure(s);
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
        const tk = s.target.states[k];
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
      ? `hand-computed 315°, abeam, leg-2, turn (starboard and port, mid-turn and leg 2), leg-3 and second-turn (both directions, mid-arc and leg 3) cases match; t = 0 bearing and range match the drawn parameters, and ownship kinematics (step ≤ v·dt, chord heading between the stored courses, turn ≤ ω·dt per step, |turn| ≤ 180°) hold, on ${String(n)} scenarios` +
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
