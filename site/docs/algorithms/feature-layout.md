# Feature layout

Source: `packages/features`. Requirements: SRD §4, spec 001 FR-010–FR-012.

Both model variants read the same tensors; they differ only in whether the encoder may look ahead.
Two feature sets exist: `raw` (below, iterations 1–2 phase A) and `derived` (raw plus three
channels, [below](#derived-feature-set)).

## Inputs (raw set) — `[N, 240, 10]`


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

## Derived feature set

Requirements: SRD §4 (derived features reserved for when raw features stall), spec 003 US3,
research R6. Source: `packages/features/src/derived.ts`. Built with
`tma-features norm|build --feature-set derived`; the default is `raw`.

The `derived` set is the 10 raw channels followed by three more, so its inputs are
`[N, 240, 13]`:

| # | Channel | Encoding |
| --- | --- | --- |
| 10 | `bearing_rate_scaled` | trailing least-squares [bearing rate](../glossary.md) ÷ `bearing_rate_scale_rad_s` |
| 11 | `rate_valid` | 1 if the rate was computed (≥ 3 valid samples in its window) |
| 12 | `intercept_scaled` | [bearing-line intercept](../glossary.md) in km ÷ `position_scale_km` |

All three are 0 on dropout rows (no bearing) and on padding rows.

**Bearing rate.** At row _t_ with a bearing, take the valid samples _k_ among the trailing
18 rows (_t_ − 17 … _t_, 3 min at 10 s). With τₖ = tₖ − tₜ and uₖ the bearing difference
bₖ − bₜ wrapped to [−π, π] (so a track crossing north has no 2π jump), the rate is the
least-squares slope

ḃ = (m Σ τu − Σ τ Σ u) / (m Σ τ² − (Σ τ)²),  m = number of valid samples.

With m < 3 the rate is 0 and `rate_valid` is 0. A 10 s finite difference would be useless at
σ = 2° (≈ 0.28°/s of noise against true rates of ≈ 0.005–0.3°/s); the 18-sample slope has ≈ 0.009°/s
of noise at σ = 2°.

**Bearing-line intercept.** c = x_o cos b − y_o sin b (ownship x east, y north; b clockwise from
north). A target at (x, y) on the bearing line satisfies x cos b − y sin b = c, the
[pseudo-linear measurement](../glossary.md): with constant target
velocity, every row is one linear equation in the target's initial position and velocity given
sin b, cos b, t and c. This is the structure a classical pseudo-linear estimator uses, offered to
the network directly.

**Causality.** Both channels at row _t_ read only rows ≤ _t_ (the rate's window is trailing; the
intercept uses row _t_ alone), so the instantaneous models stay causal. A test perturbs every
row after _t_ (bearings and dropout flags) and checks that rows ≤ _t_ are byte-identical.

**Normalisation, inputs only.** `bearing_rate_scale_rad_s` is the 90th percentile (nearest rank)
of |ḃ| over every train row that has a rate, float32. It reads bearings, dropout flags and times
only; a counterfactual test scrambles target truth and checks that the constant and every derived
input are byte-identical. `build --feature-set derived` refuses a norm file without the constant.
On the iteration-2 training split (seed 201) it is 0.00161 rad/s (0.092°/s).

**One set per model.** The layout JSON names the feature set and its channel list. A model's
input width is its features file's; training refuses a file whose set differs from the config's
`feature_set`, and prediction refuses a file of another set than the model was trained on.

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

`speed_scale_mps` comes from ownship speeds, but it also scales the target-speed target. Target
speeds go up to about 1.33 × the scale. This does no harm: the constant is still computed from
inputs only, and the output head is linear, so nothing clips (G2 panel, round 1).

## File

`.features.bin`: magic `TMAFEAT\0`, version, `FeatureLayout` JSON, `NormalisationConstants` JSON,
then (format 2) the source dataset's `DatasetHeader` JSON and the SHA-256 of the dataset file,
then scenario indices, then the three tensors as little-endian float32, each scenario-major.
Format 2 (iteration 2) carries the dataset's [provenance](generator.md#provenance) into training,
where `tma-train` checks it; the layout names its `feature_set` (`raw` or `derived`) and input
channels, and the inputs tensor is `[N, 240, 10]` or `[N, 240, 13]` accordingly. Format-1 files
(iteration 1) are still read, but training refuses them (`lineage-missing`).
