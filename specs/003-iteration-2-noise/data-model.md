# Data Model: Iteration 2

Additions to `schema/tma.yaml` (version 0.4.0 → 0.5.0, additive). Every new slot on an existing
class is optional, so 0.4.0 files still parse; the tools that need a slot refuse files without it.
Generated types, validators and the data dictionary are regenerated (`pnpm schema:gen`).

## DatasetHeader (extended) — US1, research R2

| Slot | Type | Notes |
| --- | --- | --- |
| `generator_git_commit` | string? | Commit of the checkout that ran `tma-generate` |
| `generator_git_dirty` | boolean? | Working tree had changes at generation (`--allow-dirty` only) |

Absent in files written before 0.5.0; `tma-train` refuses features whose source header lacks them.

## ScenarioParameters / ParameterRanges / ScenarioMetadata (extended) — US6, research R3 **[USER]**

| Class | Slot | Type | Notes |
| --- | --- | --- | --- |
| `ParameterRanges` | `ownship_turn_rate_rad_s` | FloatRange? | Absent = instantaneous zig (iterations 0–1) |
| `ScenarioParameters` | `ownship_turn_rate_rad_s` | float? | Drawn turn rate; absent or 0 = instantaneous |
| `ScenarioMetadata` | `turn_start_index` | integer? | First sample after the turn starts |
| `ScenarioMetadata` | `zig_index` | (unchanged) | Description amended: first sample on leg 2, i.e. after the turn completes |

`GENERATOR_VERSION` 0.1.0 → 0.2.0 (only if US6 is accepted). Removed from this spec if deferred.

## FeatureSet (enum, new) — US3, research R6

`raw` (iteration-1 layout, 10 input channels), `derived` (13 input channels).

## FeatureLayout (description amended)

Inputs `[N, 240, 10]` for `raw` (unchanged) or `[N, 240, 13]` for `derived`: the raw channels then
`bearing_rate_scaled`, `rate_valid`, `intercept_scaled`. New optional slot `feature_set: FeatureSet`
(absent = `raw`). Targets and loss mask unchanged.

## NormalisationConstants (extended)

| Slot | Type | Notes |
| --- | --- | --- |
| `bearing_rate_scale_rad_s` | float? | P90 of \|trailing LS bearing rate\| over train inputs; required for `derived` |

## Features file header (binary format version 1 → 2; not a schema class)

Version 2 adds, after the normalisation JSON: `u32 H | source DatasetHeader JSON (H, padded)` and
`u32 D | source dataset SHA-256 (D, padded)`; the layout JSON carries `feature_set`. Readers accept
version 1 (iteration-1 re-runs) and version 2. Documented in the LinkML description of
`FeatureLayout` and on the feature-layout site page.

## TrainingConfig (extended)

| Slot | Type | Notes |
| --- | --- | --- |
| `feature_set` | FeatureSet? | Absent = `raw`; must match the features file or training refuses |

## ModelManifest (extended)

| Slot | Type | Notes |
| --- | --- | --- |
| `source_dataset_header` | DatasetHeader? | Copied from the train features file (lineage) |
| `g0_experiment` | string? | Id of the G0 verdict the guard accepted |

## GateResult (enum, extended) — research R8

Adds `inconclusive`. A gate verdict is `pass` only if every check passes, `fail` if any check fails,
otherwise `inconclusive`.

## GateCheck (extended)

| Slot | Type | Notes |
| --- | --- | --- |
| `value` | float? | Statistic tested (e.g. median range error) |
| `threshold` | float? | Limit it is tested against |
| `ci_low`, `ci_high` | float? | Bootstrap CI bounds |
| `ci_level` | float? | 0.95 |

Existing G0/G1 checks leave them absent; their verdicts are unchanged.

## MetricsRecord (extended) — research R10

| Slot | Type | Notes |
| --- | --- | --- |
| `position_window_m_median` | float? | Median over scenarios of per-scenario mean \|p̂ − p\| over predicted rows |
| `position_window_m_p90` | float? | 90th percentile of the same |

Slice keys gain `dropout_band=0-5pct` and `dropout_band=5-10pct` (string values, no schema change).

## PairedComparison (new) — research R9

| Slot | Type | Notes |
| --- | --- | --- |
| `estimator`, `reference` | string | Model label; `classical:per_timestep` |
| `slice`, `point` | string | As `MetricsRecord` |
| `n_common` | integer | Rows both answered (converged, finite) |
| `coverage_estimator`, `coverage_reference` | float | Answered / scored, per estimator |
| `range_rel_median`, `range_rel_median_ref` | float? | On common rows |
| `range_rel_p90`, `range_rel_p90_ref` | float? | |
| `course_deg_median`, `course_deg_median_ref` | float? | |
| `speed_kt_median`, `speed_kt_median_ref` | float? | |
| `gross_error_rate`, `gross_error_rate_ref` | float? | |

Written as `comparison.csv` / `comparison.json`.

## ChangeDecision (new) — research R5

| Slot | Type | Notes |
| --- | --- | --- |
| `phase_a_experiment` | string | Validation experiment id |
| `stalled` | boolean | Any gated criterion failed or inconclusive on validation |
| `change` | string | e.g. `feature_set: derived` |
| `rationale` | string | Evidence cited (validation metrics only) |
| `carried_set_rule` | string | Pre-declared rule for choosing A or B |
| `decided_at`, `git_commit` | string | Committed before phase B training |

Stored as `decision.json` beside a human-readable `decision.md`.

## Reused unchanged

`Prediction`, `PredictionRow`, `CurvePoint`, `ExperimentManifest` (its `estimators[].settings_json`
holds each model manifest path and digest), `GateVerdict` with `gate: G2`.
