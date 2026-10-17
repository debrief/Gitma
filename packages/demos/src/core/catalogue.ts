// What the viewer can show (spec 006): scenario sources, model pairs and bookmarks. The site's
// prebuild writes one catalogue from the committed configs and experiment folders; these types
// describe that file, which is viewer configuration, not a pipeline record (plan: Constitution I).
import type { FeatureSet, NaiveMeans, NormalisationConstants, ParameterRanges } from "@tma/types";

/** A contiguous index range of one seeded dataset: one split, regenerated on demand. */
export interface ScenarioSource {
  id: string;
  label: string;
  /** Dataset seed, decimal uint64. */
  seed: string;
  /** First index (inclusive) and last (exclusive), as `planSplits` assigns them. */
  start: number;
  end: number;
  ranges: ParameterRanges;
  note?: string;
}

export type Variant = "instantaneous" | "time_late";

export interface ModelEntry {
  /** Model id from its manifest, e.g. `lstm-instantaneous`. */
  id: string;
  variant: Variant;
  /** Path of the model folder under the viewer's model base URL. */
  path: string;
  featureSet: FeatureSet;
  normalisation: NormalisationConstants;
  parameterCount: number;
  /** One line describing the architecture, e.g. `LSTM 2 × 128`. */
  architecture: string;
  /** Seed of the dataset the model was trained on, when its manifest records it. */
  trainedOnSeed: string | null;
  bestEpoch: number;
}

/** One gate's carried pair, with that gate's naive per-timestep means (SRD §5 baseline). */
export interface ModelPair {
  id: string;
  label: string;
  /** Experiment folder the pair was scored in. */
  experiment: string;
  gate: string;
  instantaneous: ModelEntry;
  timeLate: ModelEntry;
  naive: NaiveMeans;
}

export type Mode = "truth" | "instantaneous" | "time-late";

export interface Bookmark {
  label: string;
  source: string;
  index: number;
  mode?: Mode;
  /** Cursor time, seconds from window start. */
  t?: number;
  pair?: string;
  note?: string;
}

export interface ViewerCatalogue {
  generatorVersion: string;
  sources: ScenarioSource[];
  pairs: ModelPair[];
  bookmarks: Bookmark[];
}
