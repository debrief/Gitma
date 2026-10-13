# Feature layout

Source: `packages/features`. Requirements: SRD §4, spec 001 FR-010–FR-012.

Both model variants read the same tensors; they differ only in whether the encoder may look ahead.

## Inputs — `[N, 240, 10]`

One row per 10 s sample, padded with zero rows to 240.

| # | Channel | Encoding |
| --- | --- | --- |
| 0–1 | `bearing_sin`, `bearing_cos` | sin/cos of the observed bearing; 0, 0 at a dropout |
| 2–3 | `own_x_scaled`, `own_y_scaled` | ownship position in km ÷ `position_scale_km` |
| 4–5 | `own_course_sin`, `own_course_cos` | ownship course |
| 6 | `own_speed_scaled` | ownship speed ÷ `speed_scale_mps` |
| 7 | `time_scaled` | seconds since window start ÷ `time_scale_s` (not normalised to window length) |
| 8 | `valid` | 1 if a bearing was observed |
| 9 | `window_mask` | 1 inside the window, 0 in padding |

## Targets — `[N, 240, 6]`

`log_range_km` (natural log), `course_sin`, `course_cos`, `speed_scaled` (÷ `speed_scale_mps`),
`x_km`, `y_km` (target position, reported only).

## Loss mask — `[N, 240]`

1 inside the window **after** the zig (rows `> zig_index`), else 0. Before the zig the range is
unobservable, so penalising it would only teach the prior.

## Normalisation (inputs only)

`position_scale_km`, `speed_scale_mps` and `time_scale_s` are the maxima of |ownship x|, |ownship y|,
ownship speed and timestamp over the **train** split. Target truth is never read. A test shuffles
target tracks across scenarios and checks that the constants do not change.

## File

`.features.bin`: magic `TMAFEAT\0`, version, `FeatureLayout` JSON, `NormalisationConstants` JSON,
then (format 2) the source dataset's `DatasetHeader` JSON and the SHA-256 of the dataset file,
then scenario indices, then the three tensors as little-endian float32, each scenario-major.
Format 2 (iteration 2) carries the dataset's [provenance](generator.md#provenance) into training,
where `tma-train` checks it; the layout names its `feature_set` (`raw`). Format-1 files
(iteration 1) are still read, but training refuses them (`lineage-missing`).
