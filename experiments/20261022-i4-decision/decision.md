# Iteration 4 decision (spec 008)

Committed before any iteration-4 weights are trained. `tma-g2` checks that the commit adding
`decision.json` is an ancestor of every carried model's training commit. It uses no seed-205 test
result; seed 205's test split is scored once, at the gate.

## Evidence

- **Iteration 3** (`../20261021-i3a-val/validation.md`): stopped at validation. LSTM speed 1.10 kt
  [1.06, 1.16], BiLSTM 1.02 kt [0.98, 1.05], classical 0.34 kt on the same rows. The gap to
  classical widened to 3.3 ×.
- **Spec 008 research R1** (iteration-3 validation predictions, by true target speed): the LSTM
  shrinks speed towards the middle of the range (+0.95 kt for 0–5 kt targets, −1.67 kt for
  17.5–20 kt); classical is unbiased. An oracle removal of that bias reaches only 1.01 kt: the
  rest is scatter.
- **Owner's choice** (decision 23, 2026-10-22): the speed output parameterisation as velocity
  components (Annex A B.2.2), combined with the derived features (B.2.3) after R1.

## The change (decision 23)

- **Outputs.** Log range, vx and vy ÷ 10.29 m/s (the top of the target speed range), and an unused
  fourth channel; course and speed derived. `loss_weight_speed` 4 on each velocity component; no
  course term.
- **Inputs.** The derived feature set (13 channels: bearing rate, its validity flag, bearing-line
  intercept).
- **Everything else as iteration 3**: 2 × 128 stacked recurrent layers, `max_epochs` 150,
  patience 6, seeds 1001–1005, length bucketing; generator 0.3.0 and iteration 3's ranges
  (`configs/iter4-ranges.json`, byte-identical). `configs/iter4/a`.
- **Data.** Seed 205, count 100,000, content digests pinned in `configs/iter4/a/plan.json`. Its
  own test split decides G2.

Two levers at once: the record reports the combination and attributes nothing to either alone.

## Forecast, recorded before the run

- **Speed at zig + 600 s, σ = 1°.** The instantaneous LSTM should reach **0.90–1.10 kt**, central
  about 1.0 kt. The velocity outputs can remove at most about 0.1 kt (R1's oracle); the derived
  features' effect is untested, and this range assumes they remove a further 0–0.1 kt of scatter.
  A G2 pass, which needs the whole interval below 1 kt, is possible but less likely than not.
- **Time-late.** Similar or slightly better (the iteration-3 BiLSTM was 1.02 kt).
- **Range.** Similar to iteration 3 (8.8% / 7.2%).
- **Course.** Could worsen on slow targets (no course term; research R2), but should stay under
  10°.

## Validation rule (spec 008 FR-006, Annex A B.3.3)

After training, `tma-g2 --split validation --compare-models experiments/20261021-i3a-val/models`
scores the iteration-4 models, the iteration-3 models and classical on the same rows of seed 205's
validation split and writes `paired.json`. Everything below is at σ = 1°, zig + 600 s, with
`bootstrapMedianRatio`, 2,000 resamples, seed 20261011. The carried pair goes to the test split
only if both of these hold:

1. **A G2 pass is possible (operative).** The iteration-4 LSTM's G2 speed interval has a lower
   bound under 1 kt.
2. **Speed moved (B.3.3).** The paired median speed ratio, iteration-4 LSTM over iteration-3 LSTM,
   has a 95% interval wholly below 1. The iteration-3 models were trained on the same problem, so
   this is a like-for-like reference.

**Reported, not conditions:** the paired ratio to classical; the time-late model on both measures.
If either condition fails, iteration 4 stops at validation and is written up without test scoring.

## Record fields

`decision.json` names the plan (`configs/iter4/a/plan.json`) and its test seed (205). `stalled` is
true: the previous configuration (iteration 3) did not pass G2. The gate command scores the
iteration-3 models beside the carried set, which needs a stalled decision.

## Carried set (pre-declared)

The iteration-4 LSTM and BiLSTM are carried unconditionally once the validation rule holds. The
iteration-3 models are scored beside them on the same seed-205 split as the other phase: reported,
never gated. The split is scored once:

`tma-g2 --split test --plan configs/iter4/a/plan.json --decision experiments/20261022-i4-decision/decision.json --compare-models experiments/20261021-i3a-val/models`
