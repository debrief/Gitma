# Phase 4b decision: the tracker hybrid at G5 (decision 30)

This record is committed before seed 213's test split is scored. Requirements: SRD Annex C §C.10;
spec 013. Owner decision 2026-11-01: a hybrid of the frozen estimators, judged by G5 unchanged.

## What is judged

**`hybrid-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-c45`**, built by `tma-hybrid-track`
from two frozen estimators' predictions on the same rows:
- **The reference IMM** `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8` (decision 29), run with `tma-track`.
- **T2, `lstm-gaussian`**, `experiments/20261101-p4b-models/models/tracker`, bound by file digest
  (`model_digests`: weights 05e36db5…, manifest b951f8c8…, model.json c5ab6e3f…). It was trained
  before this decision, so `tma-g5` checks digests in place of training ancestry.

**The rule.** T2's range always; T2's course and speed where |course_IMM − course_T2| > 45°, the
IMM's otherwise. θ = 45° was chosen on seed-211 validation by the criterion Annex C §C.10 declares
(the largest smallest margin over the five gated checks; spec 013 R2).

## What is frozen

- **The gate.** G5 exactly as Annex C §C.5: σ = 1° rows at zig + 5/10/15/20 min; overall range and
  course wholly below 1 × the IMM; settled range, course and speed wholly below 1.1 ×;
  scenario-clustered paired bootstrap, 97.5% intervals, 2,000 resamples.
- **The test.** Fresh seed 213 (400,000 scenarios; its 40,000-scenario test split, generated
  alone), pinned in `configs/phase4/h/plan.json`. `tma-g5 --decision
  experiments/20261101-p4h-decision/decision.json --plan configs/phase4/h/plan.json --model
  experiments/20261101-p4b-models/models/tracker`.
- **T2's features** on seed 213 use the seed-211 training normalisation, built by
  `train-plan.mjs data configs/phase4/h/plan.json <dir> test`.
- **Re-score.** One, on a larger fresh seed, if the result is inconclusive.
- **Reported beside it.** T2 alone, the EKF `ekf-sa0.03-p4-r8` and naive, on the same rows.

## Validation (in-sample, spec 013 R2)

| Gated check | Hybrid / IMM, 97.5% CI | Limit |
| --- | --- | --- |
| Overall range | 0.847 [0.816, 0.878] | < 1 |
| Overall course | 0.897 [0.875, 0.922] | < 1 |
| Settled range | 0.973 [0.917, 1.032] | < 1.1 |
| Settled course | 0.982 [0.963, 0.998] | < 1.1 |
| Settled speed | 0.991 [0.970, 1.013] | < 1.1 |

## Forecast, recorded before scoring

- **P(G5 pass on seed 213) about 85%.** The test split has about four times as many σ = 1°
  scenarios as validation, so intervals are about half as wide.
- **Weakest checks.** Settled range, which rests on T2 alone (validation upper bound 1.03 against
  1.1), and overall course (0.90; its margin is the one θ traded away).
- **Expected values.** Overall range 0.83–0.87 ×, overall course 0.88–0.92 ×, settled checks
  0.95–1.02 ×.
- **A fail most likely means** θ was over-fitted to seed 211's validation rows, or seed 213 differs
  more than expected; both would be reported as such.

## Known limits, stated in advance

- **Not a learned tracker alone.** A pass shows that a learned estimator adds value inside a
  hybrid with a tuned tracker, as G3's hybrid did for classical least squares. It does not show that
  T2 alone beats the IMM.
- **The rule family was chosen after seeing phase 4's validation result.** The fresh seed guards
  against over-fitting θ, not against the choice of family; the write-up states this.
