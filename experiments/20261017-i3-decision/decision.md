# Iteration 3 decision (spec 007)

Committed before any iteration-3 weights are trained. `tma-g2` checks that the commit adding
`decision.json` is an ancestor of every carried model's training commit. It uses no seed-204 test
result; seed 204's test split is scored once, at the gate.

## Evidence

- **The 2c gate** (`../20261016-i2d-g2/`): G2 failed on speed, 1.47 kt and 1.53 kt against 1 kt.
  Classical reached 0.61 kt.
- **The owner's realism check** (SRD Annex A §A.7, 2026-10-17): with both platforms on steady legs
  there is too little information. An operator zigs again, and turns across towards the contact.
- **Spec 007 research R1** (seed-203 gate predictions, observational slices):
  - Shorter first legs are worse.
  - A turn towards the target helps only when it crosses the line of sight.
  - Larger turns help every estimator.
  - No slice brings the models within 2× of classical.
- **Spec 007 research R2** (classical forecast, scratch seed 9001): on the iteration-3 ranges,
  classical speed at zig + 600 s is 0.36 kt, against 0.67 kt on the iteration-2 ranges. At
  zig + 300 s it is 0.56 kt, against 1.13 kt.

## The single change (decision 22, Annex A D4, 2026-10-17)

- **The problem.**
  - Generator 0.3.0 with `configs/iter3-ranges.json`: a second zig 180–300 s after leg 2 starts.
  - Both turns cross the line of sight, putting the target 30–90° on the other bow, by the
    shorter turn.
  - Everything else is as iteration 2: first zig at 40–60% of the window, turn rate 0.5–3°/s,
    σ 1–2°, dropouts ≤ 10%, 2–20 km, held-out 20–30 km.
- **Models.** The 2c configuration from scratch (`configs/iter3/a`, identical to
  `configs/iter2/d`): 2 × 128 stacked LSTM / BiLSTM / shuffled control, CNN and MLP controls,
  `loss_weight_speed` 4, `max_epochs` 150, patience 6, raw features, seeds 1001–1005.
- **Data.** Seed 204, count 100,000, content digests pinned in `configs/iter3/a/plan.json`. Its own
  test split decides G2. Seeds 201–203 are not used.

## Forecast, recorded before the run

- **Speed at zig + 600 s, σ = 1°.** The instantaneous model should reach about 1.1–1.3 kt,
  probably still above 1 kt. That is from R1's cross-slice relation (model ≈ 1.0 + 0.75 ×
  classical) with classical at 0.36 kt. Time-late should be similar.
- **Range and course.** Both should pass with larger margins than 2c's 13% and 7°.
- **A pass** needs the models, trained on an all-favourable distribution, to use the extra
  information better than 2c did in iteration 2's best slices (1.12–1.32 kt).

## Validation rule (spec 007 FR-006, Annex A B.3.3)

After training, `tma-g2 --split validation --compare-models experiments/20261016-i2d-g2/models` runs
on seed 204's validation split. It scores the iteration-3 models, the 2c models and classical on
the same rows, and writes `paired.json`. Everything below is at σ = 1°, zig + 600 s.

A change to the problem has no like-for-like counterfactual for "moved speed". 2c's own figures
are on another problem, and 2c degrades on this one: on scratch seed 9001 its LSTM reaches
1.93 kt here, against 1.49 kt on the iteration-2 ranges (G0 panel round 2, statistics). The
carried pair goes to the test split only if both of these hold:

1. **A G2 pass is possible (operative).** The iteration-3 LSTM's G2 speed interval on validation
   has a lower bound under 1 kt.
2. **Training on the new problem helped (sanity, weak reference).** The paired median speed ratio,
   iteration-3 LSTM over 2c LSTM (`bootstrapMedianRatio`, 2,000 resamples, seed 20261011), has a
   95% interval wholly below 1. This is not cited as evidence that the lever worked.

**Reported, as the measure of what the models gained.** The paired median speed ratio,
iteration-3 LSTM over classical on the same rows, with its interval. 2c's 2.37 on its own
validation is context only: an unpaired ratio of medians on another problem, not a threshold the
interval is tested against. The time-late model is reported the same way, not as a condition. If either
condition fails, iteration 3 stops at validation and is written up without test scoring.

## How the gate reads under three legs

Gate times still count from the end of the first turn (spec 007, "Reading the gate under three
legs"). On the G0 data, at zig + 300 s, 59% of scenarios are mid-way through the second turn and
37% are on leg 3. Range and course are therefore judged mostly during the second manoeuvre. At
zig + 600 s, 99.9% are on leg 3, with a median of 280 s of it. Coverage: 98.9% of scenarios reach
zig + 300 s and 65.4% reach zig + 600 s. Windows skew long (p10 16.7 min). Slices carry their n.

## Record fields

`decision.json` names the plan (`configs/iter3/a/plan.json`) and its test seed (204). `tma-g2`
scores seed 204's test split only with this record (spec 007 FR-009).

`stalled` is true: the previous configuration failed G2 (2c, `../20261016-i2d-g2/`), which is what
the field records. The gate command scores the 2c models beside the carried set
(`--compare-models`). That makes `tma-g2` treat the run as having a phase B, and it requires a
stalled decision.

## Carried set (pre-declared)

The iteration-3 LSTM and BiLSTM are carried unconditionally. The 2c models are scored beside them
on the same seed-204 split as the other phase: reported, never gated. The split is scored once:

`tma-g2 --split test --plan configs/iter3/a/plan.json --decision experiments/20261017-i3-decision/decision.json --compare-models experiments/20261016-i2d-g2/models`
