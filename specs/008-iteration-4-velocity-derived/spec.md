# Feature Specification: Iteration 4 — Velocity Outputs and Derived Features (Gate G2)

**Feature Branch**: `008-iteration-4-velocity-derived`

**Created**: 2026-10-22

**Status**: Planned. Levers chosen by the owner (decision 23), 2026-10-22.

**Input**: Iteration 3 stopped at validation (`experiments/20261021-i3a-val/validation.md`): the
LSTM reached 1.10 kt [1.06, 1.16] against 1 kt, and classical 0.34 kt. The owner chose the speed
output parameterisation (Annex A B.2.2) as velocity components. Research R1 showed that removing
the LSTM's speed bias entirely would only reach 1.01 kt, so the owner combined it with the derived
features (B.2.3), which target the remaining scatter.

**SRD trace**: Annex A Part B: levers B.2.2 and B.2.3 under the sequence and rules of B.3; §4
(model outputs); §5 (G2 thresholds, times, slices and intervals unchanged); §8 (panel, decision
23); §9 (blog, results).

**Out of scope**: changes to the problem (generator 0.3.0 and the iteration-3 ranges are kept);
training changes and capacity (B.2.4, B.2.5); the hybrid (B.2.6); real data.

## The change

The models change; the problem does not.

- **Velocity outputs** (`output_parameterisation: velocity`, schema 0.10.0). The four output
  channels become log range, vx and vy divided by `velocity_scale_mps` (10.29 m/s, the top of the
  target speed range), and an unused channel. Course and speed are derived from (vx, vy).
  `loss_weight_speed` (4) weights each velocity component; there is no course term.
- **Derived features** (`feature_set: derived`, 13 channels): the raw ten plus the causal bearing
  rate, its validity flag and the bearing-line intercept (spec 003 R6).
- **Everything else as iteration 3** (`configs/iter4/a`, compared field by field in a test): 2 × 128
  stacked recurrent layers, `max_epochs` 150, patience 6, length bucketing, seeds 1001–1005, on
  iteration 3's three-leg problem (`configs/iter4-ranges.json` is byte-identical to
  `configs/iter3-ranges.json`).
- **Dataset**: seed **205**, count 100,000, digests pinned. Its own test split decides G2; 205 is
  reserved for iteration 4.

## User stories

### US1 — Train and predict with velocity outputs (P1)

`tma-train`, `tma-model-predict`, `tma-g1`, `tma-g2` and the viewer read the model's output
parameterisation from its manifest and decode accordingly. Course_speed models (iterations 1–3)
decode exactly as before.

**Acceptance**: truth-valued velocity outputs decode to the truth; the loss matches a hand
computation; batches carry the re-encoded targets; a velocity model trains and predicts end to
end; the data and features goldens change only in `schema_version`.

### US2 — Pre-register, train, validate (P1)

The decision record (`experiments/20261022-i4-decision/`) is committed before training. Then
`train/i4a`, and a validation diagnostic with the iteration-3 models beside, before any test
scoring.

### US3 — Gate and record (P1)

If the validation rule holds: `tma-g2 --split test --plan --decision --compare-models` scores the
carried set once on seed 205's test split, with the iteration-3 models beside it. Then the agent
review panel, `review.md`, `decided_by`, a results page and a blog post.

## Functional requirements

- **FR-001**: Course_speed models decode and train exactly as before (the output parameterisation
  is absent from their manifests).
- **FR-002**: The features files keep storing course_speed targets. Training re-encodes them per
  model; no truth statistic enters the velocity scale.
- **FR-003**: A velocity config without a positive `velocity_scale_mps` is refused.
- **FR-004**: The other phase of a `tma-g2` run may use a feature set the plan did not build; its
  inputs are then built with its own normalisation and feature set. The carried set never takes
  this path.
- **FR-005**: The decision record MUST be committed before any iteration-4 weights are trained.
- **FR-006 (validation rule, B.3.3).** On seed 205's validation split, σ = 1°, zig + 600 s, rows
  common to both sets, paired bootstrap (`bootstrapMedianRatio`, 2,000 resamples, seed
  20261011):
  1. **Operative.** The iteration-4 LSTM's G2 speed interval has a lower bound under 1 kt.
  2. **Moved speed.** The paired median speed ratio, iteration-4 LSTM over iteration-3 LSTM, has a
     95% interval wholly below 1. Unlike iteration 3, this is a like-for-like reference: the
     iteration-3 models were trained on the same problem (seed 204), so they are in distribution
     on seed 205.

  The pair goes to the test split only if both hold. Otherwise the iteration stops at validation
  and is written up. The paired ratio to classical is reported, not a condition.
- **FR-007**: The carried set is the iteration-4 LSTM and BiLSTM. The iteration-3 models are
  scored beside them on the same split, reported and never gated.
- **FR-008**: Thresholds, slices, bootstrap and the gate rule are unchanged. Course is watched:
  the velocity loss weighs course less on slow targets (research R2).

## Success criteria

- **SC-001**: One test scoring of seed 205 for the carried set, if the rule holds.
- **SC-002**: Every reported model figure sits beside naive and classical on the same rows.
- **SC-003**: The write-up reports the combination and does not attribute an effect to either
  lever alone.

## Risks

- **Two levers at once** (research R4): the record cannot separate them.
- **Course on slow targets** (research R2): no course term in the loss.
- **Speed shrinkage under course uncertainty** (research R2): small at iteration 3's course errors.
- **Forecast below the bar.** The forecast in the decision record puts a pass in reach but not
  likely.
