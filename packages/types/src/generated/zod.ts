// GENERATED from schema/tma.yaml by packages/types/scripts/generate.ts. Do not edit.
import { z } from "zod";

/** Closed interval [min, max]. */
export const FloatRange = z.strictObject({
  max: z.number(),
  min: z.number(),
});
export type FloatRange = z.infer<typeof FloatRange>;

export const RangeDistribution = z.enum(["uniform", "log_uniform"]);
export type RangeDistribution = z.infer<typeof RangeDistribution>;

/** Ranges from which ScenarioParameters are drawn. Initial ownship course, target bearing and target course are always uniform on [0, 2π); zig sign is uniform ±. */
export const ParameterRanges = z.strictObject({
  dropout_fraction: FloatRange,
  dt_s: z.number(),
  /** Geometries closer than this at any sample are redrawn. */
  min_range_m: z.number(),
  /** σ drawn uniformly from this set. */
  noise_sigma_rad_values: z.array(z.number()),
  ownship_speed_mps: FloatRange,
  range_distribution: RangeDistribution,
  target_range0_m: FloatRange,
  target_speed_mps: FloatRange,
  window_s: FloatRange,
  zig_angle_abs_rad: FloatRange,
  zig_fraction: FloatRange,
});
export type ParameterRanges = z.infer<typeof ParameterRanges>;

/** Discriminator for records in NDJSON files. */
export const RecordKind = z.enum(["header", "scenario", "prediction"]);
export type RecordKind = z.infer<typeof RecordKind>;

/** Dataset split. Train/validation/test are 80/10/10 by scenario index. */
export const Split = z.enum(["train", "validation", "test", "heldout"]);
export type Split = z.infer<typeof Split>;

/** First record of every dataset file. */
export const DatasetHeader = z.strictObject({
  /** Command line that produced the file. */
  created_by: z.string(),
  /** Decimal uint64 string. */
  dataset_seed: z.string(),
  generator_version: z.string(),
  /** Last scenario index (exclusive). */
  index_end: z.number().int(),
  /** First scenario index (inclusive). */
  index_start: z.number().int(),
  parameter_ranges: ParameterRanges,
  record: RecordKind,
  /** Geometries rejected for violating min_range_m. */
  redraw_count: z.number().int(),
  scenario_count: z.number().int(),
  schema_version: z.string(),
  split: Split,
});
export type DatasetHeader = z.infer<typeof DatasetHeader>;

export const DatasetRef = z.strictObject({
  header: DatasetHeader,
  path: z.string(),
});
export type DatasetRef = z.infer<typeof DatasetRef>;

export const EstimatorRef = z.strictObject({
  name: z.string(),
  /** Estimator settings as JSON. */
  settings_json: z.string(),
});
export type EstimatorRef = z.infer<typeof EstimatorRef>;

/** Fixed scaling constants computed from the train split's input channels only. */
export const NormalisationConstants = z.strictObject({
  /** Always "inputs_only". */
  computed_from: z.string(),
  position_scale_km: z.number(),
  speed_scale_mps: z.number(),
  time_scale_s: z.number(),
  /** SHA-256 of the train header. */
  train_header_digest: z.string(),
});
export type NormalisationConstants = z.infer<typeof NormalisationConstants>;

/** Everything needed to reproduce an experiment run. */
export const ExperimentManifest = z.strictObject({
  command_lines: z.array(z.string()),
  /** ISO 8601 timestamp. */
  created: z.string(),
  datasets: z.array(DatasetRef),
  estimators: z.array(EstimatorRef),
  generator_version: z.string(),
  git_commit: z.string(),
  id: z.string(),
  normalisation: NormalisationConstants.nullish(),
  schema_version: z.string(),
});
export type ExperimentManifest = z.infer<typeof ExperimentManifest>;

/** Documents the model tensors (not stored as records). inputs [N, 240, 10]: bearing_sin, bearing_cos, own_x_km, own_y_km, own_course_sin, own_course_cos, own_speed_scaled, time_scaled, valid, window_mask. targets [N, 240, 6]: log_range_km, course_sin, course_cos, speed_scaled, x_km, y_km. loss_mask [N, 240]: window_mask and t ≥ zig_time. */
export const FeatureLayout = z.strictObject({
  input_channels: z.array(z.string()),
  rows: z.number().int(),
  target_channels: z.array(z.string()),
});
export type FeatureLayout = z.infer<typeof FeatureLayout>;

export const GateResult = z.enum(["pass", "fail"]);
export type GateResult = z.infer<typeof GateResult>;

export const GateCheck = z.strictObject({
  detail: z.string(),
  name: z.string(),
  result: GateResult,
});
export type GateCheck = z.infer<typeof GateCheck>;

export const GateId = z.enum(["G0", "G1", "G2", "G3"]);
export type GateId = z.infer<typeof GateId>;

/** Machine verdict for a gate; the team review records the final decision. */
export const GateVerdict = z.strictObject({
  checks: z.array(GateCheck),
  decided_by: z.string(),
  gate: GateId,
  result: GateResult,
});
export type GateVerdict = z.infer<typeof GateVerdict>;

/** Metric values for one estimator on one slice at one evaluation point. */
export const MetricsRecord = z.strictObject({
  course_deg_median: z.number().nullish(),
  course_deg_p90: z.number().nullish(),
  estimator: z.string(),
  excluded: z.number().int(),
  gross_error_rate: z.number().nullish(),
  n: z.number().int(),
  /** "final" or "zig+<n>s". */
  point: z.string(),
  position_m_mean: z.number().nullish(),
  range_rel_median: z.number().nullish(),
  range_rel_p90: z.number().nullish(),
  /** "overall" or e.g. "range_band=5-10km". */
  slice: z.string(),
  speed_kt_median: z.number().nullish(),
  speed_kt_p90: z.number().nullish(),
});
export type MetricsRecord = z.infer<typeof MetricsRecord>;

/** One bearing from ownship to target. Stone Soup analogue Detection. When valid is false (dropout) bearing_rad is 0 and must be ignored. */
export const Observation = z.strictObject({
  bearing_rad: z.number(),
  timestamp_s: z.number(),
  valid: z.boolean(),
});
export type Observation = z.infer<typeof Observation>;

/** One platform state. Stone Soup analogue GroundTruthState. */
export const PlatformState = z.strictObject({
  course_rad: z.number(),
  speed_mps: z.number(),
  timestamp_s: z.number(),
  x_m: z.number(),
  y_m: z.number(),
});
export type PlatformState = z.infer<typeof PlatformState>;

export const PredictionMode = z.enum(["final", "per_timestep"]);
export type PredictionMode = z.infer<typeof PredictionMode>;

/** An estimator's target estimate at one timestep. */
export const PredictionRow = z.strictObject({
  converged: z.boolean(),
  course_rad: z.number(),
  iterations: z.number().int().nullish(),
  range_m: z.number(),
  speed_mps: z.number(),
  timestamp_s: z.number(),
  x_m: z.number(),
  y_m: z.number(),
});
export type PredictionRow = z.infer<typeof PredictionRow>;

/** One estimator's output for one scenario. */
export const Prediction = z.strictObject({
  estimator: z.string(),
  mode: PredictionMode,
  record: RecordKind,
  rows: z.array(PredictionRow),
  scenario_index: z.number().int(),
});
export type Prediction = z.infer<typeof Prediction>;

/** First record of every prediction file. */
export const PredictionHeader = z.strictObject({
  /** SHA-256 of the truth file. */
  dataset_digest: z.string(),
  estimator: z.string(),
  mode: PredictionMode,
  record: RecordKind,
  schema_version: z.string(),
});
export type PredictionHeader = z.infer<typeof PredictionHeader>;

/** The random draws that define one scenario. */
export const ScenarioParameters = z.strictObject({
  /** Probability each bearing is missing. */
  dropout_fraction: z.number(),
  /** Bearing interval. */
  dt_s: z.number(),
  /** Bearing noise σ; 0 = noise-free. */
  noise_sigma_rad: z.number(),
  /** Ownship course on leg 1. */
  ownship_course0_rad: z.number(),
  ownship_speed_mps: z.number(),
  /** True bearing at window start. */
  target_bearing0_rad: z.number(),
  target_course_rad: z.number(),
  /** Range at window start. */
  target_range0_m: z.number(),
  target_speed_mps: z.number(),
  /** Window length; multiple of dt_s. */
  window_s: z.number(),
  /** Signed course change at the zig; positive is clockwise. */
  zig_angle_rad: z.number(),
  /** Zig time as a fraction of the window. */
  zig_fraction: z.number(),
});
export type ScenarioParameters = z.infer<typeof ScenarioParameters>;

/** Seed, parameter draws and derived slicing keys for one scenario. */
export const ScenarioMetadata = z.strictObject({
  /** Scenario index within the dataset. */
  index: z.number().int(),
  mean_range_m: z.number(),
  min_range_m: z.number(),
  parameters: ScenarioParameters,
  /** Number of timesteps (60–240). */
  samples: z.number().int(),
  /** Scenario seed as a decimal uint64 string. */
  seed: z.string(),
  /** First timestep on leg 2. */
  zig_index: z.number().int(),
  zig_time_s: z.number(),
});
export type ScenarioMetadata = z.infer<typeof ScenarioMetadata>;

export const TrackId = z.enum(["ownship", "target"]);
export type TrackId = z.infer<typeof TrackId>;

/** Time-ordered states of one platform. Stone Soup analogue GroundTruthPath. */
export const Track = z.strictObject({
  id: TrackId,
  states: z.array(PlatformState),
});
export type Track = z.infer<typeof Track>;

/** One ownship-vs-target run over a window. */
export const Scenario = z.strictObject({
  metadata: ScenarioMetadata,
  observations: z.array(Observation),
  ownship: Track,
  record: RecordKind,
  target: Track,
});
export type Scenario = z.infer<typeof Scenario>;
