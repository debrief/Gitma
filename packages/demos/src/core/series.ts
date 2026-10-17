// Time series for the viewer's plots (spec 006 FR-004): both platforms' course and speed, the
// observed and true bearing, the bearing rate the `derived` feature set computes, and the range.
import { scenarioBearingRate } from "@tma/features/browser";
import { bearingOf, mpsToKt, radToDeg } from "@tma/sim";
import type { Scenario } from "@tma/types";

export interface Series {
  /** Seconds from window start, one per sample. */
  t: number[];
  ownCourseDeg: number[];
  ownSpeedKt: number[];
  tgtCourseDeg: number[];
  tgtSpeedKt: number[];
  /** Observed bearing, degrees true; null on dropouts. */
  bearingObsDeg: (number | null)[];
  bearingTrueDeg: number[];
  /** Trailing least-squares bearing rate (features `derived.ts`), degrees per minute; null where undefined. */
  bearingRateDegMin: (number | null)[];
  rangeKm: number[];
}

const deg360 = (rad: number): number => {
  const d = radToDeg(rad) % 360;
  return (d < 0 ? d + 360 : d) + 0;
};

/** True bearing from ownship to target at sample i, radians. */
export function trueBearing(s: Scenario, i: number): number {
  const o = s.ownship.states[i];
  const t = s.target.states[i];
  if (o === undefined || t === undefined) throw new RangeError(`no sample ${String(i)}`);
  return bearingOf(t.x_m - o.x_m, t.y_m - o.y_m);
}

export function seriesOf(s: Scenario): Series {
  const n = s.metadata.samples;
  const rate = scenarioBearingRate(s);
  const out: Series = {
    t: [],
    ownCourseDeg: [],
    ownSpeedKt: [],
    tgtCourseDeg: [],
    tgtSpeedKt: [],
    bearingObsDeg: [],
    bearingTrueDeg: [],
    bearingRateDegMin: [],
    rangeKm: [],
  };
  for (let i = 0; i < n; i++) {
    const o = s.ownship.states[i];
    const g = s.target.states[i];
    const b = s.observations[i];
    if (o === undefined || g === undefined || b === undefined)
      throw new RangeError(`no sample ${String(i)}`);
    out.t.push(o.timestamp_s);
    out.ownCourseDeg.push(deg360(o.course_rad));
    out.ownSpeedKt.push(mpsToKt(o.speed_mps));
    out.tgtCourseDeg.push(deg360(g.course_rad));
    out.tgtSpeedKt.push(mpsToKt(g.speed_mps));
    out.bearingObsDeg.push(b.valid ? deg360(b.bearing_rad) : null);
    out.bearingTrueDeg.push(deg360(trueBearing(s, i)));
    out.bearingRateDegMin.push(rate.valid[i] === 1 ? radToDeg(rate.rate[i] ?? 0) * 60 : null);
    out.rangeKm.push(Math.hypot(g.x_m - o.x_m, g.y_m - o.y_m) / 1000);
  }
  return out;
}

/**
 * Ownship's legs as sample index ranges: leg 1, the turn (empty for an instantaneous zig), leg 2,
 * and with a second zig (generator 0.3.0) the second turn and leg 3; leg 2 then ends where the
 * second turn starts. The second-zig keys are absent with one zig.
 */
export interface Legs {
  leg1: [number, number];
  turn: [number, number];
  leg2: [number, number];
  turn2?: [number, number];
  leg3?: [number, number];
}

export function legsOf(s: Scenario): Legs {
  const m = s.metadata;
  const turnStart = m.turn_start_index ?? m.zig_index;
  const z2 = m.zig2_index;
  if (z2 == null) {
    return { leg1: [0, turnStart], turn: [turnStart, m.zig_index], leg2: [m.zig_index, m.samples] };
  }
  const t2 = m.turn2_start_index ?? z2;
  return {
    leg1: [0, turnStart],
    turn: [turnStart, m.zig_index],
    leg2: [m.zig_index, t2],
    turn2: [t2, z2],
    leg3: [z2, m.samples],
  };
}

/** Sample index nearest a time, within the window. */
export function sampleAt(s: Scenario, t: number): number {
  const i = Math.round(t / s.metadata.parameters.dt_s);
  return Math.min(s.metadata.samples - 1, Math.max(0, Number.isFinite(i) ? i : 0));
}
