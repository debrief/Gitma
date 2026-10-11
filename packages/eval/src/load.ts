import { readFileSync } from "node:fs";
import { fileDigest, parsePredictions } from "@tma/classical";
import type { Prediction } from "@tma/types";
import type { PredictionSet } from "./evaluate.js";

/** Load a prediction file, checking it was made from `truthPath` (dataset digest). */
export function loadPredictionSet(path: string, truthPath: string): PredictionSet {
  const { header, predictions } = parsePredictions(path, readFileSync(path, "utf8"));
  const digest = fileDigest(truthPath);
  if (header.dataset_digest !== digest) {
    throw new Error(`${path}: predictions were made from a different truth file than ${truthPath}`);
  }
  const byIndex = new Map<number, Prediction>(predictions.map((p) => [p.scenario_index, p]));
  const label =
    header.mode === "per_timestep" ? `${header.estimator}:per_timestep` : header.estimator;
  return { label, estimator: header.estimator, byIndex };
}

/** FR-019: no report without naive and classical numbers on the same test set. */
export function requireBaselines(sets: PredictionSet[]): void {
  const names = new Set(sets.map((s) => s.estimator));
  const missing = ["naive", "classical"].filter((n) => !names.has(n));
  if (missing.length > 0) {
    throw new Error(
      `refusing to report without baseline predictions: missing ${missing.join(", ")} (FR-019)`,
    );
  }
}
