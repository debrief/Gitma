// Naive baseline (SRD §5): predict training-set means of log range, course vector and speed.
// A model that cannot beat this has learned nothing.
import { bearingOf, f32, f32Angle } from "@tma/sim";
import type {
  NaiveMeans,
  NaiveModel,
  Prediction,
  PredictionMode,
  PredictionRow,
  Scenario,
} from "@tma/types";
import { SCHEMA_VERSION } from "@tma/types";

export const NAIVE = "naive";

interface Acc {
  logRange: number;
  sin: number;
  cos: number;
  speed: number;
  n: number;
}

const acc = (): Acc => ({ logRange: 0, sin: 0, cos: 0, speed: 0, n: 0 });

function addLabel(a: Acc, s: Scenario, i: number): void {
  const o = s.ownship.states[i];
  const t = s.target.states[i];
  if (o === undefined || t === undefined) throw new Error(`no sample ${String(i)}`);
  a.logRange += Math.log(Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m) / 1000);
  a.sin += Math.sin(t.course_rad);
  a.cos += Math.cos(t.course_rad);
  a.speed += t.speed_mps;
  a.n++;
}

const means = (a: Acc): NaiveMeans => ({
  log_range_km: a.logRange / a.n,
  course_sin: a.sin / a.n,
  course_cos: a.cos / a.n,
  speed_mps: a.speed / a.n,
  n: a.n,
});

/** Fit on training scenarios: final = last-sample labels; per_timestep = every post-zig label. */
export function fitNaive(train: Iterable<Scenario>, trainDigest: string): NaiveModel {
  const fin = acc();
  const per = acc();
  for (const s of train) {
    const n = s.metadata.samples;
    addLabel(fin, s, n - 1);
    for (let i = s.metadata.zig_index + 1; i < n; i++) addLabel(per, s, i);
  }
  if (fin.n === 0) throw new Error("cannot fit naive baseline on an empty training set");
  return {
    schema_version: SCHEMA_VERSION,
    train_digest: trainDigest,
    final: means(fin),
    per_timestep: means(per),
  };
}

/** Last valid bearing at or before sample i (for the derived position), or null. */
function lastBearing(s: Scenario, i: number): number | null {
  for (let k = i; k >= 0; k--) {
    const o = s.observations[k];
    if (o?.valid === true) return o.bearing_rad;
  }
  return null;
}

function naiveRow(s: Scenario, m: NaiveMeans, i: number): PredictionRow {
  const own = s.ownship.states[i];
  if (own === undefined) throw new Error(`no sample ${String(i)}`);
  const range = 1000 * Math.exp(m.log_range_km);
  const b = lastBearing(s, i) ?? 0;
  return {
    timestamp_s: own.timestamp_s,
    range_m: f32(range),
    course_rad: f32Angle(bearingOf(m.course_sin, m.course_cos)),
    speed_mps: f32(m.speed_mps),
    x_m: f32(own.x_m + range * Math.sin(b)),
    y_m: f32(own.y_m + range * Math.cos(b)),
    converged: true,
  };
}

/** Same row layout as the classical estimator, so the two are scored identically. */
export function naivePredict(s: Scenario, model: NaiveModel, mode: PredictionMode): Prediction {
  const n = s.metadata.samples;
  const rows: PredictionRow[] = [];
  if (mode === "final") rows.push(naiveRow(s, model.final, n - 1));
  else {
    for (let i = s.metadata.zig_index + 1; i < n; i++)
      rows.push(naiveRow(s, model.per_timestep, i));
  }
  return { record: "prediction", scenario_index: s.metadata.index, estimator: NAIVE, mode, rows };
}
