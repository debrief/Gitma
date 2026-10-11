// Model outputs → Prediction rows (research R7), scored by the iteration-0 harness unchanged.
import { resolve } from "node:path";
import * as tf from "@tensorflow/tfjs-node";
import { canonicalJson } from "@tma/data";
import { type FeatureFile, ROWS } from "@tma/features";
import { bearingOf, f32, f32Angle } from "@tma/sim";
import type { NormalisationConstants, Prediction, PredictionRow, Scenario } from "@tma/types";
import { NI } from "@tma/features";
import { NO } from "./architectures.js";

/** Last valid bearing at or before sample i (the derived position uses it, as naive does). */
function lastBearing(s: Scenario, i: number): number | null {
  for (let k = i; k >= 0; k--) {
    const o = s.observations[k];
    if (o?.valid === true) return o.bearing_rad;
  }
  return null;
}

/**
 * One scenario's per-timestep prediction from the model's [ROWS × NO] output (row-major), rows from
 * zig_index + 1 to the last sample. Uses only ownship and bearings from `s`, never target truth.
 * Non-finite outputs or no bearing yet → `converged = false` (scored as gross).
 */
export function outputsToPrediction(
  s: Scenario,
  out: Float32Array,
  norm: NormalisationConstants,
  estimator: string,
): Prediction {
  const n = s.metadata.samples;
  if (out.length !== ROWS * NO) throw new Error(`expected ${String(ROWS * NO)} outputs`);
  const rows: PredictionRow[] = [];
  for (let i = s.metadata.zig_index + 1; i < n; i++) {
    const own = s.ownship.states[i];
    if (own === undefined) throw new Error(`no sample ${String(i)}`);
    const a = i * NO;
    const logR = out[a] ?? NaN;
    const sin = out[a + 1] ?? NaN;
    const cos = out[a + 2] ?? NaN;
    const spd = out[a + 3] ?? NaN;
    const range = 1000 * Math.exp(logR);
    const speed = spd * norm.speed_scale_mps;
    const b = lastBearing(s, i);
    const ok =
      b !== null &&
      Number.isFinite(range) &&
      Number.isFinite(speed) &&
      Number.isFinite(sin) &&
      Number.isFinite(cos) &&
      (sin !== 0 || cos !== 0);
    rows.push(
      ok
        ? {
            timestamp_s: own.timestamp_s,
            range_m: f32(range),
            course_rad: f32Angle(bearingOf(sin, cos)),
            speed_mps: f32(speed),
            x_m: f32(own.x_m + range * Math.sin(b)),
            y_m: f32(own.y_m + range * Math.cos(b)),
            converged: true,
          }
        : {
            timestamp_s: own.timestamp_s,
            range_m: 0,
            course_rad: 0,
            speed_mps: 0,
            x_m: 0,
            y_m: 0,
            converged: false,
          },
    );
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator,
    mode: "per_timestep",
    rows,
  };
}

export async function loadModel(dir: string): Promise<tf.LayersModel> {
  return tf.loadLayersModel(`file://${resolve(dir)}/model.json`);
}

/** Refuse features normalised differently from the model's training data. */
export function requireSameNormalisation(
  file: FeatureFile,
  norm: NormalisationConstants,
  modelId: string,
): void {
  if (canonicalJson(file.norm) !== canonicalJson(norm)) {
    throw new Error(`${file.path}: normalisation differs from the one ${modelId} was trained with`);
  }
}

/** Runs the model over every scenario of `truth` (looked up in `features` by index). */
export function predictScenarios(
  model: tf.LayersModel,
  features: FeatureFile,
  truth: Iterable<Scenario>,
  norm: NormalisationConstants,
  estimator: string,
  batchSize = 256,
): Prediction[] {
  const where = new Map<number, number>();
  features.indices.forEach((idx, k) => where.set(idx, k));
  const out: Prediction[] = [];
  let pending: Scenario[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const x = new Float32Array(pending.length * ROWS * NI);
    pending.forEach((s, j) => {
      const k = where.get(s.metadata.index);
      if (k === undefined)
        throw new Error(`${features.path}: no window for scenario ${String(s.metadata.index)}`);
      x.set(features.read(k).inputs, j * ROWS * NI);
    });
    const y = tf.tidy(() => {
      const p = model.predict(tf.tensor3d(x, [pending.length, ROWS, NI])) as tf.Tensor;
      return p.dataSync() as Float32Array;
    });
    pending.forEach((s, j) => {
      out.push(
        outputsToPrediction(s, y.subarray(j * ROWS * NO, (j + 1) * ROWS * NO), norm, estimator),
      );
    });
    pending = [];
  };
  for (const s of truth) {
    pending.push(s);
    if (pending.length === batchSize) flush();
  }
  flush();
  return out;
}
