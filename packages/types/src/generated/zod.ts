// GENERATED from schema/tma.yaml by packages/types/scripts/generate.ts. Do not edit.
import { z } from "zod";

/** A trained model named by its manifest id and the SHA-256 of its files (schema 0.11.0; manifest and model.json digests from 0.11.1). */
export const ModelDigest = z.strictObject({
  /** SHA-256 (hex) of the model's manifest.json (schema 0.11.1). */
  manifest_sha256: z.string(),
  /** The model's manifest id. */
  model: z.string(),
  /** SHA-256 (hex) of the model's model.json, its topology (schema 0.11.1). */
  model_json_sha256: z.string(),
  /** SHA-256 (hex) of the model's weights.bin; equals its manifest weights_digest. */
  weights_sha256: z.string(),
});
export type ModelDigest = z.infer<typeof ModelDigest>;

/** The single change of the iteration's change round, fixed from validation evidence and committed before phase B trains (spec 003 R5). */
export const ChangeDecision = z.strictObject({
  /** G4: the manifest id of the one carried network (Annex B §B.4); tma-g4 refuses network predictions from another model. */
  carried_model: z.string().nullish(),
  carried_set_rule: z.string(),
  /** e.g. feature_set: derived */
  change: z.string(),
  decided_at: z.string(),
  /** The dataset count whose test split a re-score scores (the plan's dataset.fresh_test.count; schema 0.11.1); tma-g2 refuses a plan with another count. */
  fresh_test_count: z.number().int().nullish(),
  git_commit: z.string(),
  /** The frozen carried models a re-score scores, by manifest id, with the SHA-256 of each one's weights.bin, manifest.json and model.json; tma-g2 refuses a re-score whose carried set or any of those files differs. */
  model_digests: z.array(ModelDigest).nullish(),
  phase_a_experiment: z.string(),
  /** The plan this decision pre-registers (configs/<…>/plan.json). Required from iteration 3 (spec 007): tma-g2 scores a test split only with the decision that names its plan. */
  plan: z.string().nullish(),
  /** Validation evidence cited. */
  rationale: z.string(),
  /** G4 (spec 010, schema 0.13.0): the frozen reference tracker's estimator name, which encodes every tuning parameter (e.g. imm-cv0-ct0.03-w0.003-s0.0001-r4); tma-g4 refuses reference predictions with another name. */
  reference_estimator: z.string().nullish(),
  /** The experiment directory of the inconclusive gate this decision re-scores (SRD §7: one re-score on a larger fresh-seed test set; e.g. experiments/20261024-i4-g2). When present, tma-g2 runs in re-score mode (--rescore-of): the frozen carried models are bound by model_digests instead of by training ancestry, the re-scored gate must be inconclusive and not itself a re-score, and the fresh test seed must differ from its test seed. */
  rescore_of: z.string().nullish(),
  /** Any gated criterion failed or was inconclusive on validation. */
  stalled: z.boolean(),
  /** Dataset seed of the test split the decision commits to (the plan's fresh_test seed, or its dataset seed); tma-g2 checks it against the plan. */
  test_seed: z.string().nullish(),
});
export type ChangeDecision = z.infer<typeof ChangeDecision>;

/** The committed model a seeded continuation started from (scripts/train-continue.mjs; spec 003 decision 14, spec 004 decision 15). Its epoch records up to best_epoch are kept in the continued run's manifest, with their val_loss as recorded under the earlier config. */
export const Continuation = z.strictObject({
  best_epoch: z.number().int(),
  /** The source model's training-code commit, when it recorded one. */
  git_commit: z.string().nullish(),
  /** The source's best weights re-scored under the continued run's loss, written by tma-train when it resumed (spec 004 FR-002). With best_epoch and best_val_loss it makes the kept weights auditable: a run whose best_epoch is the source's must have best_val_loss equal to this value and weights_digest equal to the source's. */
  rescored_val_loss: z.number().nullish(),
  /** The source's best-epoch validation loss under the source's config. */
  val_loss: z.number(),
  /** SHA-256 of the weights the continuation resumed from (the source's best epoch). */
  weights_digest: z.string(),
});
export type Continuation = z.infer<typeof Continuation>;

/** One point of an error-vs-time-since-zig curve (curves.csv row). */
export const CurvePoint = z.strictObject({
  course_deg_median: z.number().nullish(),
  estimator: z.string(),
  gross_error_rate: z.number(),
  n: z.number().int(),
  non_converged_rate: z.number().nullish(),
  /** Absent when not finite (more than half the rows non-converged), as in MetricsRecord. */
  range_rel_median: z.number().nullish(),
  range_rel_p90: z.number().nullish(),
  speed_kt_median: z.number().nullish(),
  t_since_zig_s: z.number(),
});
export type CurvePoint = z.infer<typeof CurvePoint>;

/** Closed interval [min, max]. */
export const FloatRange = z.strictObject({
  max: z.number(),
  min: z.number(),
});
export type FloatRange = z.infer<typeof FloatRange>;

export const RangeDistribution = z.enum(["uniform", "log_uniform"]);
export type RangeDistribution = z.infer<typeof RangeDistribution>;

/** How each zig's direction and size are chosen (generator 0.3.0, spec 007). */
export const ZigRule = z.enum(["random", "across_los"]);
export type ZigRule = z.infer<typeof ZigRule>;

/** Ranges from which ScenarioParameters are drawn. Initial ownship course, target bearing and target course are always uniform on [0, 2π); zig sign is uniform ±. */
export const ParameterRanges = z.strictObject({
  dropout_fraction: FloatRange,
  dt_s: z.number(),
  /** Angle off the line of sight, on the other bow, after an across_los turn; required when zig_rule is across_los. */
  los_offset_rad: FloatRange.nullish(),
  /** Geometries closer than this at any sample are redrawn. */
  min_range_m: z.number(),
  /** σ drawn uniformly from this set. */
  noise_sigma_rad_values: z.array(z.number()),
  ownship_speed_mps: FloatRange,
  /** Turn rate drawn uniformly per scenario; absent means an instantaneous zig. */
  ownship_turn_rate_rad_s: FloatRange.nullish(),
  range_distribution: RangeDistribution,
  /** Generator 0.5.0 (SRD Annex C §C.2): probabilities of 0, 1, 2, … target course changes (summing to 1). Present: every scenario draws its manoeuvres this way, with target_manoeuvre_angle_abs_rad, target_turn_rate_rad_s, target_manoeuvre_after_zig_s and target_manoeuvre_margin_s, and target_manoeuvre_fraction must be absent. */
  target_course_change_count_weights: z.array(z.number()).nullish(),
  /** Earliest start of the target's turn, after the first sample on leg 2. */
  target_manoeuvre_after_zig_s: z.number().nullish(),
  /** Absolute target course change; the sign is uniform ±. */
  target_manoeuvre_angle_abs_rad: FloatRange.nullish(),
  /** Probability a scenario's target makes one course change (generator 0.4.0, SRD Annex B §B.2); absent means the target always holds course, as generators 0.1.0–0.3.0. When present, every scenario draws the manoeuvre parameters (so the PRNG is consumed alike) and the window must fit a turn whether or not one is made. */
  target_manoeuvre_fraction: z.number().nullish(),
  /** Least time from the end of the target's turn to the end of the window, so the gate point (manoeuvre + 5 min) is reached. */
  target_manoeuvre_margin_s: z.number().nullish(),
  /** Least time from the end of one target manoeuvre to the start of the next. */
  target_manoeuvre_spacing_s: z.number().nullish(),
  target_range0_m: FloatRange,
  /** Absolute speed change; its sign is uniform ±, flipped if the new speed would leave target_speed_mps (redrawn if both signs would). */
  target_speed_change_abs_mps: FloatRange.nullish(),
  /** Probability of one target speed change (generator 0.5.0). */
  target_speed_change_fraction: z.number().nullish(),
  /** Magnitude of the target's acceleration during a speed change. */
  target_speed_change_rate_mps2: FloatRange.nullish(),
  target_speed_mps: FloatRange,
  /** Target turn rate, drawn uniformly per scenario. */
  target_turn_rate_rad_s: FloatRange.nullish(),
  window_s: FloatRange,
  /** Delay from the start of leg 2 to the second turn; absent means one zig. The second zig follows zig_rule (and uses the same turn rate as the first). */
  zig2_delay_s: FloatRange.nullish(),
  zig_angle_abs_rad: FloatRange,
  zig_fraction: FloatRange,
  /** How each zig is chosen; absent means random (generators 0.1.0–0.2.0). Under across_los zig_angle_abs_rad is still drawn but not used. */
  zig_rule: ZigRule.nullish(),
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
  /** Commit of the checkout that ran tma-generate (absent before schema 0.8.0). */
  generator_git_commit: z.string().nullish(),
  /** True when that checkout had uncommitted changes (only allowed with --allow-dirty; absent before schema 0.8.0). */
  generator_git_dirty: z.boolean().nullish(),
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
  /** SHA-256 of the dataset file (absent in manifests written before schema 0.4.0). */
  digest: z.string().nullish(),
  header: DatasetHeader,
  path: z.string(),
});
export type DatasetRef = z.infer<typeof DatasetRef>;

export const EpochRecord = z.strictObject({
  epoch: z.number().int(),
  /** Cumulative wall time. */
  seconds: z.number(),
  train_loss: z.number(),
  val_loss: z.number(),
});
export type EpochRecord = z.infer<typeof EpochRecord>;

export const EstimatorRef = z.strictObject({
  name: z.string(),
  /** Estimator settings as JSON. */
  settings_json: z.string(),
});
export type EstimatorRef = z.infer<typeof EstimatorRef>;

/** Fixed scaling constants computed from the train split's input channels only. */
export const NormalisationConstants = z.strictObject({
  /** 90th percentile of |trailing least-squares bearing rate| over train inputs; required for the derived feature set. */
  bearing_rate_scale_rad_s: z.number().nullish(),
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
  /** True when the working tree had uncommitted changes (absent before schema 0.4.0). */
  git_dirty: z.boolean().nullish(),
  id: z.string(),
  /** Node.js version that ran the experiment (byte identity is promised per pinned Node). */
  node_version: z.string().nullish(),
  normalisation: NormalisationConstants.nullish(),
  schema_version: z.string(),
});
export type ExperimentManifest = z.infer<typeof ExperimentManifest>;

/** Model input channel sets (spec 003 R6). */
export const FeatureSet = z.enum(["raw", "derived"]);
export type FeatureSet = z.infer<typeof FeatureSet>;

/** Documents the model tensors (not stored as records). inputs [N, 240, 10]: bearing_sin, bearing_cos, own_x_km, own_y_km, own_course_sin, own_course_cos, own_speed_scaled, time_scaled, valid, window_mask; the derived feature set appends bearing_rate_scaled, rate_valid, intercept_scaled [N, 240, 13]. targets [N, 240, 6]: log_range_km, course_sin, course_cos, speed_scaled, x_km, y_km. loss_mask [N, 240]: window_mask and t ≥ zig_time. Features file format 2 also embeds the source DatasetHeader and the source dataset SHA-256. */
export const FeatureLayout = z.strictObject({
  /** Absent means raw. */
  feature_set: FeatureSet.nullish(),
  input_channels: z.array(z.string()),
  rows: z.number().int(),
  target_channels: z.array(z.string()),
});
export type FeatureLayout = z.infer<typeof FeatureLayout>;

export const GateResult = z.enum(["pass", "fail", "inconclusive"]);
export type GateResult = z.infer<typeof GateResult>;

export const GateCheck = z.strictObject({
  /** Upper bound of the bootstrap interval. */
  ci_high: z.number().nullish(),
  /** Interval coverage, e.g. 0.95. */
  ci_level: z.number().nullish(),
  /** Lower bound of the bootstrap interval. */
  ci_low: z.number().nullish(),
  detail: z.string(),
  name: z.string(),
  result: GateResult,
  /** Limit the statistic is tested against. */
  threshold: z.number().nullish(),
  /** Statistic tested (e.g. median range error). */
  value: z.number().nullish(),
});
export type GateCheck = z.infer<typeof GateCheck>;

export const GateId = z.enum(["G0", "G1", "G2", "G3", "G4"]);
export type GateId = z.infer<typeof GateId>;

/** Machine verdict for a gate; the team review records the final decision. */
export const GateVerdict = z.strictObject({
  checks: z.array(GateCheck),
  decided_by: z.string(),
  gate: GateId,
  result: GateResult,
});
export type GateVerdict = z.infer<typeof GateVerdict>;

/** What a target manoeuvre changes (generator 0.5.0, SRD Annex C §C.2). */
export const ManoeuvreKind = z.enum(["course", "speed"]);
export type ManoeuvreKind = z.infer<typeof ManoeuvreKind>;

/** Where one target manoeuvre lies in a scenario's samples (generator 0.5.0). */
export const ManoeuvreSpan = z.strictObject({
  /** First timestep after it completes. */
  end_index: z.number().int(),
  kind: ManoeuvreKind,
  /** First timestep after it starts. */
  start_index: z.number().int(),
});
export type ManoeuvreSpan = z.infer<typeof ManoeuvreSpan>;

/** Metric values for one estimator on one slice at one evaluation point. */
export const MetricsRecord = z.strictObject({
  course_deg_median: z.number().nullish(),
  course_deg_p90: z.number().nullish(),
  estimator: z.string(),
  excluded: z.number().int(),
  gross_error_rate: z.number().nullish(),
  n: z.number().int(),
  /** Fraction of rows with no estimate (scored +∞; explains absent medians/P90). */
  non_converged_rate: z.number().nullish(),
  /** "final" or "zig+<n>s". */
  point: z.string(),
  /** Mean position error over converged rows (non-converged rows count in gross_error_rate). */
  position_m_mean: z.number().nullish(),
  /** Median over scenarios of each scenario's mean position error over its predicted rows (time-late window-mean position, SRD §5; reported, not gated). */
  position_window_m_median: z.number().nullish(),
  /** 90th percentile over scenarios of the same per-scenario mean. */
  position_window_m_p90: z.number().nullish(),
  range_rel_median: z.number().nullish(),
  range_rel_p90: z.number().nullish(),
  /** "overall" or e.g. "range_band=5-10km". */
  slice: z.string(),
  speed_kt_median: z.number().nullish(),
  speed_kt_p90: z.number().nullish(),
});
export type MetricsRecord = z.infer<typeof MetricsRecord>;

/** Model families of SRD §4. */
export const ModelKind = z.enum(["instantaneous", "time_late", "causal_cnn", "mlp"]);
export type ModelKind = z.infer<typeof ModelKind>;

export const StopReason = z.enum(["max_epochs", "early_stopping", "wall_clock", "diverged"]);
export type StopReason = z.infer<typeof StopReason>;

/** How the model's four output channels encode the target's course and speed (spec 008). */
export const OutputParameterisation = z.enum(["course_speed", "velocity", "velocity_two_hypothesis"]);
export type OutputParameterisation = z.infer<typeof OutputParameterisation>;

/** Hyperparameters and seeds for one training run (SRD §4; constitution III). */
export const TrainingConfig = z.strictObject({
  batch_size: z.number().int(),
  /** Batches per length-bucketing group (default 16). */
  bucket_batches: z.number().int().nullish(),
  /** Input channel set; absent means raw. Must match the features files. */
  feature_set: FeatureSet.nullish(),
  /** Estimator name used in predictions. */
  id: z.string(),
  /** Causal CNN kernel size. */
  kernel_size: z.number().int().nullish(),
  /** Stacked layers: causal CNN conv layers (no dilation; default 3), or recurrent layers for instantaneous and time_late (default 1; each returns sequences; spec 003 R20). */
  layers: z.number().int().nullish(),
  learning_rate: z.number(),
  /** Length bucketing (research R15; default false). Each group of bucket_batches batches of the epoch's seeded permutation is sorted by valid length, cut into batches whose rows are trimmed to the longest window, and the batch order is shuffled with a seed derived from train_seed and the epoch. The model takes a variable time dimension. Not for mlp. */
  length_bucketing: z.boolean().nullish(),
  loss_weight_course: z.number(),
  /** Weight of the turn-probability cross-entropy term (velocity_two_hypothesis only; spec 011). Absent means 1. */
  loss_weight_manoeuvre: z.number().nullish(),
  loss_weight_range: z.number(),
  loss_weight_speed: z.number(),
  max_epochs: z.number().int(),
  /** Wall-clock cap in seconds. */
  max_wall_s: z.number(),
  model_kind: ModelKind,
  /** Output encoding; absent means course_speed. With velocity, loss_weight_speed weights each velocity component and loss_weight_course is unused (spec 008). */
  output_parameterisation: OutputParameterisation.nullish(),
  /** Epochs without validation improvement before stopping. */
  patience: z.number().int(),
  /** Permute targets across scenarios (leakage check). */
  shuffle_labels: z.boolean(),
  /** TensorFlow intra-op and inter-op thread count, set by tma-train through TF_NUM_INTRAOP_THREADS and TF_NUM_INTEROP_THREADS before tfjs-node loads. Absent: the TensorFlow default (one per core) or whatever the environment sets. */
  tfjs_threads: z.number().int().nullish(),
  /** Use only the first N training scenarios (tests and smoke runs). */
  train_limit: z.number().int().nullish(),
  /** Decimal uint64; derives initializer seeds and batch order. */
  train_seed: z.string(),
  /** LSTM units (per direction), conv filters or dense width. */
  units: z.number().int(),
  /** Velocity scale in m/s for the velocity parameterisation (required with it): the top of the generator's target speed range, a constant of the problem, never a truth statistic. */
  velocity_scale_mps: z.number().nullish(),
});
export type TrainingConfig = z.infer<typeof TrainingConfig>;

/** Everything needed to reproduce and identify a trained model. */
export const ModelManifest = z.strictObject({
  best_epoch: z.number().int(),
  /** The validation loss a later epoch must beat, under this manifest's config: the best epoch's val_loss, or, after a continuation changed the loss, the best weights re-scored under the new loss (spec 004 FR-002). Persisted so a chained job resumes against the same value. Absent before schema 0.8.2 (then the best epoch's recorded val_loss). */
  best_val_loss: z.number().nullish(),
  /** False while training is in progress (checkpoint). */
  complete: z.boolean(),
  config: TrainingConfig,
  /** Present when the run was seeded from a committed model (absent before schema 0.8.2). */
  continued_from: Continuation.nullish(),
  cpu_model: z.string(),
  epochs: z.array(EpochRecord),
  /** Id of the G0 experiment whose verdict the training guard accepted. */
  g0_experiment: z.string().nullish(),
  generator_version: z.string(),
  /** Commit of the training code, read when training started (absent before schema 0.6.0). */
  git_commit: z.string().nullish(),
  /** True when the working tree had uncommitted changes when training started (absent before schema 0.6.0). */
  git_dirty: z.boolean().nullish(),
  id: z.string(),
  node_version: z.string(),
  normalisation: NormalisationConstants,
  parameter_count: z.number().int(),
  schema_version: z.string(),
  /** Header of the dataset the train features came from (lineage; absent before schema 0.8.0). */
  source_dataset_header: DatasetHeader.nullish(),
  stop_reason: StopReason.nullish(),
  /** TF_NUM_INTEROP_THREADS in force when training ran (absent: unset). */
  tf_interop_threads: z.number().int().nullish(),
  /** TF_NUM_INTRAOP_THREADS in force when training ran (absent: unset, so the TensorFlow default of one per core). */
  tf_intraop_threads: z.number().int().nullish(),
  tfjs_node_version: z.string(),
  train_features_digest: z.string(),
  val_features_digest: z.string(),
  wall_s: z.number(),
  /** SHA-256 of best-epoch weights. */
  weights_digest: z.string(),
});
export type ModelManifest = z.infer<typeof ModelManifest>;

/** Training-set means used by the naive baseline for one prediction mode. */
export const NaiveMeans = z.strictObject({
  course_cos: z.number(),
  course_sin: z.number(),
  /** Mean of ln(range in km). */
  log_range_km: z.number(),
  /** Number of labels averaged. */
  n: z.number().int(),
  speed_mps: z.number(),
});
export type NaiveMeans = z.infer<typeof NaiveMeans>;

/** Naive baseline (SRD §5): predicts training-set means. final uses each scenario's last-sample label; per_timestep uses every post-zig label. */
export const NaiveModel = z.strictObject({
  final: NaiveMeans,
  per_timestep: NaiveMeans,
  schema_version: z.string(),
  /** SHA-256 of the train file. */
  train_digest: z.string(),
});
export type NaiveModel = z.infer<typeof NaiveModel>;

/** One bearing from ownship to target. Stone Soup analogue Detection. When valid is false (dropout) bearing_rad is 0 and must be ignored. */
export const Observation = z.strictObject({
  bearing_rad: z.number(),
  timestamp_s: z.number(),
  valid: z.boolean(),
});
export type Observation = z.infer<typeof Observation>;

/** A model and a reference estimator compared on rows both answered (converged and finite), with each estimator's coverage reported separately (spec 003 R9). */
export const PairedComparison = z.strictObject({
  course_deg_median: z.number().nullish(),
  course_deg_median_ref: z.number().nullish(),
  /** Answered / scored. */
  coverage_estimator: z.number(),
  /** Answered / scored. */
  coverage_reference: z.number(),
  estimator: z.string(),
  gross_error_rate: z.number().nullish(),
  gross_error_rate_ref: z.number().nullish(),
  n_common: z.number().int(),
  point: z.string(),
  range_rel_median: z.number().nullish(),
  range_rel_median_ref: z.number().nullish(),
  range_rel_p90: z.number().nullish(),
  range_rel_p90_ref: z.number().nullish(),
  reference: z.string(),
  slice: z.string(),
  speed_kt_median: z.number().nullish(),
  speed_kt_median_ref: z.number().nullish(),
});
export type PairedComparison = z.infer<typeof PairedComparison>;

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
  /** The estimator's probability that the target's turn has started by this timestep (velocity_two_hypothesis networks only; spec 011). Absent for other estimators. */
  p_manoeuvre: z.number().nullish(),
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

/** One target manoeuvre (generator 0.5.0). A course change is an arc at constant speed; a speed change is constant acceleration on a constant course. */
export const TargetManoeuvre = z.strictObject({
  /** Signed change: course in rad (positive clockwise) or speed in m/s (positive faster). */
  change: z.number(),
  kind: ManoeuvreKind,
  /** Magnitude of the rate of change, rad/s (course) or m/s² (speed). */
  rate: z.number(),
  /** Time the manoeuvre starts, a whole number of samples. */
  start_time_s: z.number(),
});
export type TargetManoeuvre = z.infer<typeof TargetManoeuvre>;

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
  /** Ownship turn rate at the zig (rate-limited turn, spec 003 US6). Absent or 0: the course changes instantaneously, as in generator 0.1.0. */
  ownship_turn_rate_rad_s: z.number().nullish(),
  /** True bearing at window start. */
  target_bearing0_rad: z.number(),
  target_course_rad: z.number(),
  /** Signed target course change; positive is clockwise. */
  target_manoeuvre_angle_rad: z.number().nullish(),
  /** Target course change (generator 0.4.0, SRD Annex B §B.2): time the target's turn starts, a whole number of samples. Absent: the target holds course. */
  target_manoeuvre_time_s: z.number().nullish(),
  /** Target manoeuvres in time order (generator 0.5.0, SRD Annex C §C.2), none overlapping. Present (possibly empty) only under generator 0.5.0 ranges; then the single-turn fields above are absent. */
  target_manoeuvres: z.array(TargetManoeuvre).nullish(),
  /** Range at window start. */
  target_range0_m: z.number(),
  target_speed_mps: z.number(),
  /** Target turn rate through its course change. */
  target_turn_rate_rad_s: z.number().nullish(),
  /** Window length; multiple of dt_s. */
  window_s: z.number(),
  /** Signed course change at the second zig; positive is clockwise. */
  zig2_angle_rad: z.number().nullish(),
  /** Second zig (generator 0.3.0, spec 007): time from the first sample on leg 2 to the start of the second turn. Absent: one zig, two legs. */
  zig2_delay_s: z.number().nullish(),
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
  /** First timestep after the target's turn completes (generator 0.4.0; absent when the target holds course). Gate G4 counts time from here, as earlier gates count from zig_index. Under generator 0.5.0, after the last manoeuvre completes. */
  manoeuvre_index: z.number().int().nullish(),
  /** First timestep after the target's turn starts (generator 0.4.0; absent when the target holds course). Under generator 0.5.0, after the first manoeuvre starts. */
  manoeuvre_start_index: z.number().int().nullish(),
  /** Generator 0.5.0: each target manoeuvre's sample span, in time order (present, possibly empty, only under 0.5.0). */
  manoeuvres: z.array(ManoeuvreSpan).nullish(),
  mean_range_m: z.number(),
  min_range_m: z.number(),
  parameters: ScenarioParameters,
  /** Number of timesteps (60–240). */
  samples: z.number().int(),
  /** Scenario seed as a decimal uint64 string. */
  seed: z.string(),
  /** First timestep after the second turn starts (absent with one zig or no turn rate). */
  turn2_start_index: z.number().int().nullish(),
  /** First timestep after the turn starts (absent for an instantaneous zig). */
  turn_start_index: z.number().int().nullish(),
  /** First timestep on leg 3, after the second turn completes (absent with one zig). Gate times still count from zig_index. */
  zig2_index: z.number().int().nullish(),
  /** First timestep on leg 2 (with a rate-limited turn, the first after it completes). */
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
