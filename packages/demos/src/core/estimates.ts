// Estimates on one scenario (spec 006 FR-006, FR-007): the models through the pipeline's own
// encoding (`buildWindow`) and decoding (`outputsToPrediction`), the classical solver and the
// naive baseline. tfjs is passed in, so this module carries no tfjs import and stays testable
// on any backend.
import {
  bearingData,
  classicalPredict,
  naivePredict,
  plausible,
  rowAt,
  solveBatch,
} from "@tma/classical/browser";
import { buildWindow, inputWidth, outputsToPrediction, ROWS } from "@tma/features/browser";
import type { NaiveMeans, Prediction, PredictionRow, Scenario } from "@tma/types";
import type { ModelEntry } from "./catalogue.js";

export interface TensorLike {
  dataSync(): ArrayLike<number>;
  dispose(): void;
}
export interface TfLike<T extends TensorLike = TensorLike> {
  tensor3d(values: Float32Array, shape: [number, number, number]): T;
}
export interface ModelLike<T extends TensorLike = TensorLike> {
  predict(x: T): TensorLike | TensorLike[];
}

/**
 * The model's estimate at every sample of `s` (rows from 0, so the pre-zig rows can be shown and
 * labelled unobservable). The instantaneous model is causal, so its row t depends only on
 * bearings up to t: one forward pass serves every cursor position.
 */
export function modelPrediction<T extends TensorLike>(
  tf: TfLike<T>,
  model: ModelLike<T>,
  s: Scenario,
  entry: Pick<ModelEntry, "id" | "featureSet" | "normalisation">,
): Prediction {
  const w = buildWindow(s, entry.normalisation, entry.featureSet);
  const x = tf.tensor3d(w.inputs, [1, ROWS, inputWidth(entry.featureSet)]);
  const outs: TensorLike[] = [];
  try {
    const y = model.predict(x);
    outs.push(...(Array.isArray(y) ? y : [y]));
    const first = outs[0];
    if (first === undefined) throw new Error(`${entry.id}: no output`);
    return outputsToPrediction(
      s,
      Float32Array.from(first.dataSync()),
      entry.normalisation,
      entry.id,
      0,
    );
  } finally {
    x.dispose();
    for (const t of outs) t.dispose();
  }
}

export const classicalRows = (s: Scenario): Prediction => classicalPredict(s, "per_timestep");

/**
 * The classical solver's time-late counterpart: one batch solution over the whole window,
 * evaluated at every sample (constant-velocity track). Rows are flagged not converged when the
 * solution is implausible, as `classicalPredict` flags them.
 */
export function classicalTrack(s: Scenario): Prediction {
  const d = bearingData(s);
  const n = s.metadata.samples;
  const sol = solveBatch(d, n);
  const rows: PredictionRow[] = [];
  if (sol !== null) {
    const ok = sol.converged && plausible(d, sol, n - 1);
    for (let i = 0; i < n; i++) rows.push({ ...rowAt(d, sol, i), converged: ok });
  }
  return {
    record: "prediction",
    scenario_index: s.metadata.index,
    estimator: "classical",
    mode: "final",
    rows,
  };
}

export const naiveRows = (s: Scenario, means: NaiveMeans): Prediction =>
  naivePredict(
    s,
    { schema_version: "", train_digest: "", final: means, per_timestep: means },
    "per_timestep",
  );

/** The prediction's row at sample i, if it has one. */
export function rowAtSample(p: Prediction | null, s: Scenario, i: number): PredictionRow | null {
  if (p === null) return null;
  const dt = s.metadata.parameters.dt_s;
  for (const r of p.rows) if (Math.round(r.timestamp_s / dt) === i) return r;
  return null;
}
