# Data Model: Iteration 0

Phase 1 output for [plan.md](plan.md). Every class below is defined once in `schema/tma.yaml` (LinkML);
this page is the design, the schema is the source of truth. Units: SI internally (s, m, m/s, rad).
All stored floats are float32-rounded ([research R4](research.md#r4-storage-formats-and-lossless-round-trip)).

## Versioning

| Slot | Type | Rule |
| --- | --- | --- |
| `schema_version` | semver string | Bumped on any schema change; readers reject a different MAJOR.MINOR |
| `generator_version` | semver string | `packages/sim` version; readers reject mismatch with the dataset header |

## Classes

### ScenarioParameters (draws for one scenario)

| Slot | Unit | Range (iteration 1 default) |
| --- | --- | --- |
| `window_s` | s | 600–2400, multiple of `dt_s` |
| `dt_s` | s | 10 (fixed) |
| `ownship_speed_mps` | m/s | 5–15 kt |
| `ownship_course0_rad` | rad | uniform [0, 2π) |
| `zig_angle_rad` | rad | ±(30–90°), sign uniform |
| `zig_fraction` | — | 0.40–0.60 of window |
| `target_range0_m` | m | 2,000–20,000, log-uniform |
| `target_bearing0_rad` | rad | uniform [0, 2π) |
| `target_speed_mps` | m/s | 3–20 kt |
| `target_course_rad` | rad | uniform [0, 2π) |
| `noise_sigma_rad` | rad | {0, 0.5°, 1°, 2°} |
| `dropout_fraction` | — | 0–0.10 |

### ParameterRanges

Min/max (or set) for every ScenarioParameters slot plus `range_distribution: log_uniform | uniform`.
Stored in the dataset header; held-out geometry uses a different instance.

### PlatformState (one row of a track; Stone Soup `GroundTruthState` analogue)

`timestamp_s`, `x_m`, `y_m`, `course_rad`, `speed_mps`.

### Track (Stone Soup `GroundTruthPath` analogue)

`id` (`ownship` | `target`), `states: PlatformState[]` (length = samples).

### Observation (Stone Soup `Detection` analogue)

`timestamp_s`, `bearing_rad` (true, clockwise from north, [0, 2π)), `valid: boolean`.
Invalid rows keep their timestamp; `bearing_rad` is 0 and must be ignored.

### ScenarioMetadata

`seed` (decimal string of uint64), `index`, `parameters: ScenarioParameters`, `zig_time_s`,
`zig_index`, `mean_range_m`, `min_range_m`, `samples`.

### Scenario

`metadata`, `ownship: Track`, `target: Track`, `observations: Observation[]`.
Invariants: all three sequences share timestamps `0, dt, …, window_s - dt`; target track is
constant-velocity; ownship has exactly one course change at `zig_index`.

### DatasetHeader

`schema_version`, `generator_version`, `dataset_seed`, `split: train | validation | test | heldout`,
`scenario_count`, `index_range`, `parameter_ranges`, `redraw_count` (geometries rejected for min range
< 100 m), `created_by` (CLI command line).

### NormalisationConstants

`position_scale_km`, `speed_scale_mps`, `time_scale_s`, plus `computed_from: inputs_only` and the
train-split header digest. Computed from **input channels of the train split only**.

### FeatureLayout (documentation of tensor shapes; tensors themselves are not stored as LinkML records)

| Tensor | Shape | Channels |
| --- | --- | --- |
| `inputs` | [N, 240, 10] | bearing_sin, bearing_cos, own_x_km, own_y_km, own_course_sin, own_course_cos, own_speed_scaled, time_scaled, valid, window_mask |
| `targets` | [N, 240, 6] | log_range_km, course_sin, course_cos, speed_scaled, x_km, y_km |
| `loss_mask` | [N, 240] | 1 where window_mask = 1 and t ≥ zig_time (causal variant) |

### Prediction

`scenario_index`, `estimator` (`naive` | `classical` | model id), `mode: final | per_timestep`,
`rows: PredictionRow[]` where a row is `timestamp_s`, `range_m`, `course_rad`, `speed_mps`, `x_m`, `y_m`,
`converged: boolean`, `iterations?`. `final` mode has one row at the window end.

### MetricsRecord

`estimator`, `slice` (`overall` or e.g. `range_band=5-10km`), `point` (`final` | `zig+300s` | `zig+<n>s`),
`n`, `excluded`, `range_rel_median`, `range_rel_p90`, `course_deg_median`, `course_deg_p90`,
`speed_kt_median`, `speed_kt_p90`, `gross_error_rate`, `position_m_mean?`.

### ExperimentManifest

`id`, `created`, `git_commit`, `schema_version`, `generator_version`, `datasets` (paths + headers),
`estimators` (name + settings), `normalisation?`, `command_lines`.

### GateVerdict

`gate: G0`, `result: pass | fail`, `checks: GateCheck[]` (`name`, `result`, `detail`), `decided_by`
(`harness`; team review recorded later).

## Relationships

```
DatasetHeader 1──* Scenario 1── ScenarioMetadata 1── ScenarioParameters
Scenario 1── Track(ownship), Track(target) 1──* PlatformState
Scenario 1──* Observation
Scenario 1── FeatureWindow (derived, not stored as record)
Estimator ──* Prediction ──► Scenario (by index)
ExperimentManifest 1──* MetricsRecord, 1── GateVerdict
```

## Validation rules

- Angles stored in [0, 2π); course differences computed as wrapped `atan2(sin Δ, cos Δ)`.
- `samples = window_s / dt_s` ∈ [60, 240].
- `zig_index` ∈ [0.4·samples, 0.6·samples].
- `valid=false` count / samples ≤ `dropout_fraction` rounding up.
- `min_range_m > 0` (generator rejects and redraws geometries with range < 100 m; count reported in header).
- Every file read is validated by generated zod schemas; failure names file and line/record.
