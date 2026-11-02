# Phase 4c decision: the fused tracker at G5 (decision 31)

This record is committed before seed 214's test split is scored.

Requirements: SRD Annex C §C.11 and spec 014. Owner decision 2026-11-02: research a fused tracker
on validation, then judge it by G5 unchanged.

## What is judged

**`fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-k4-m6`**, built by `tma-fuse-track`
from the scenario file and T2's prediction file on the same rows.

- **The reference IMM**, `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8` (decision 29), runs unchanged.
- **The fusion.** After each bearing update, every 6 samples (1 min) from zig_index + 1, the IMM
  takes T2's range as a log-range measurement. Its sd is 4 × T2's stated log-range sd. The update
  uses the Joseph form and is applied to both models; model probabilities are left to the
  bearings.
- **T2**, `lstm-gaussian`, from `experiments/20261101-p4b-models/models/tracker`, bound by file
  digest (`model_digests`). These are the same files as decision 30's: weights 05e36db5…, manifest
  b951f8c8…, model.json c5ab6e3f….
- **The prediction chain.** The fused file's header names T2's file (`inputs`), whose header names
  T2's weights (`model_weights_sha256`). On the test split, `tma-g5` refuses the fused file unless
  T2's file, passed with `--also`, matches byte for byte.

## What is frozen

- **The gate.** G5 exactly as in Annex C §C.5:
  - σ = 1° rows at zig + 5/10/15/20 min;
  - overall range and course wholly below 1 × the IMM;
  - settled range, course and speed wholly below 1.1 ×;
  - a scenario-clustered paired bootstrap, 97.5% intervals, 2,000 resamples.
- **The test.** Fresh seed 214: 400,000 scenarios, of which the 40,000-scenario test split is
  generated alone. It is pinned in `configs/phase4/f/plan.json`. The gate command is `tma-g5
  --decision experiments/20261102-p4f-decision/decision.json --plan configs/phase4/f/plan.json
  --model experiments/20261101-p4b-models/models/tracker`.
- **k = 4 and M = 6**, and the IMM's parameters, are part of the estimator name.
- **Re-score.** One, on a larger fresh seed, if the result is inconclusive.
- **Reported beside it**, on the same rows:
  - the phase-4b hybrid (θ = 45°), T2 alone, the EKF `ekf-sa0.03-p4-r8` and naive;
  - settled rows before and after any manoeuvre;
  - NEES and bearing-rate consistency.

## Validation (in-sample; `experiments/20261102-fused-research/validation/`)

| Gated check | Fused / IMM, 97.5% CI | Limit |
| --- | --- | --- |
| Overall range | 0.806 [0.780, 0.829] | < 1 |
| Overall course | 0.930 [0.907, 0.960] | < 1 |
| Settled range | 0.846 [0.801, 0.889] | < 1.1 |
| Settled course | 0.908 [0.873, 0.952] | < 1.1 |
| Settled speed | 0.882 [0.836, 0.933] | < 1.1 |

`tma-fuse-track` reproduces the research script's ratios to within float32 storage rounding
(spec 014 R4).

## Forecast, recorded before scoring

- **P(G5 pass on seed 214) about 85%.**
  - The test split has about four times validation's σ = 1° rows, so the intervals are about half
    as wide.
  - The settings were chosen in-sample from 12 variants, but on a broad plateau. Phase 4b's
    θ-dependent ratios moved by less than 0.01 from validation to test.
- **Weakest check: overall course.** On validation it is 0.93, with an upper bound of 0.96 against
  a limit of 1.
- **Settled range is less exposed than the hybrid's.** It no longer rests on T2 alone; phase 4b's
  settled range moved from 0.97 to 1.02 between validation and test.
- **Expected values:**
  - overall range 0.79–0.84 ×;
  - overall course 0.91–0.95 ×;
  - settled range 0.83–0.90 ×;
  - settled course and speed 0.87–0.94 ×.
- **A fail would most likely mean** the plateau does not transfer to seed 214, or overall course
  regresses. Either would be reported as such; phase 4b's pass stands.

## Known limits, stated in advance

- **Not a learned tracker alone.** It is a filter that takes a frozen network's range.
- **The settings and the design were chosen after phase 4b's result**, on the validation rows that
  also chose θ. Only the fresh seed decides.
- **Its stated covariance is not calibrated**, as the reference IMM's is not.
- **Against the EKF** it is still worse on settled course: about 1.3 × on validation.
