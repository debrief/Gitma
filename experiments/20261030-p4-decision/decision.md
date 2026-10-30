# Phase 4 decision: two learned trackers against the re-tuned reference (decision 29)

This record is committed before either tracker is trained. Seed 212's test split exists only to
pin its digest; it has not been scored.
- **Requirements:** `docs/SRD-annex-C.md`, `specs/012-phase-4-trackers/`.
- **Owner decision:** decision 28, 2026-10-30. Build both trackers, judge them on generator 0.5.0
  data at G5, and decide the follow-on if G5 fails.

## The trackers

| | T1 | T2 |
| --- | --- | --- |
| Model | `learned-gain-filter` (`configs/phase4/a/tracker.json`) | `lstm-gaussian` (`configs/phase4/b/tracker.json`) |
| Design | A declared filter layer: constant-velocity prediction, wrapped bearing update, gain from a 64-unit GRU ([note](../../site/docs/algorithms/learned-gain-filter.md)) | 2 × 128 LSTM layers with a Gaussian head (means and log-variances of log range, vx and vy; NLL) |
| Features | raw | derived |
| Output | velocity | velocity_gaussian (the mean is scored) |
| Common | batch 256, learning rate 1e-3, `loss_weight_speed` 4, length bucketing, patience 6, from scratch | as T1 |
| Train seed | 1201 | 1202 |
| Plan | `configs/phase4/a/plan.json` (push `train/p4a`) | `configs/phase4/b/plan.json` (push `train/p4b`) |

Both train on seed 211's train split (80,000 scenarios, 360-row windows).

**Training cost** (spec 012 R1), measured on 4 idle cores with full-length windows:
- T2 takes 11.4 s per batch of 256, about 1.0 h per epoch.
- T1 takes 5.2 s per batch, about 0.5 h per epoch.

Length bucketing shortens both. T2 may need more than CI's three chained jobs; re-dispatching
`train.yml` resumes it.

## What is frozen

- **The reference.** `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8`: the IMM with σ_cv 0.01, σ_ct 0.03,
  σ_ω 0.01, switch 0.001/s, P0 × 4 and R × 8. Research R2 found it the better of the two tuned
  trackers on seed-211 validation:

  | Estimator | Median range, all G5 rows | Settled | zig + 5 / 10 / 15 / 20 min |
  | --- | --- | --- | --- |
  | IMM (reference) | 9.24% | 7.2% | 5.5 / 9.2 / 13.0 / 16.6% |
  | EKF `ekf-sa0.03-p4-r8` | 9.72% | 7.1% | |
  | Batch least squares | 12.2% | 6.7% | 5.3 / 12.2 / 23.8 / 34.8% |

  - **Two declared grids.** The second extended the first after its optimum sat on the R and P0
    edges. The optimum is now inside the grid on both. It is flat in σ_cv and σ_ct, with the top
    four within 0.05 points.
  - **σ_ct = 0.03 is the grid's lowest value,** but 0.1 is within 0.04 points.
- **G5.** As Annex C §C.5, run by `tma-g5` (`packages/eval/src/gate-g5.ts`):
  - rows on the σ = 1° slice at zig + 5, 10, 15 and 20 min;
  - settled rows as §C.5 pins them;
  - a scenario-clustered paired bootstrap with 97.5% intervals per tracker;
  - overall range and course wholly below 1 × the reference;
  - settled range, course and speed wholly below 1.1 ×.
- **The validation rule.** On seed 211's validation split, a tracker is carried only if every gated
  check's point meets its limit and no interval lies wholly beyond it. Both, one or neither may be
  carried. If neither is, the test split is not scored and the owner decides the follow-on (C.6).
- **The test.** `tma-g5 --decision experiments/20261030-p4-decision/decision.json --plan … --model …`
  on fresh seed 212 (400,000 scenarios, so 40,000 test scenarios, generated alone; its digest is
  pinned in both plans). One re-score on a larger fresh seed is allowed if the result is
  inconclusive.
- **Reported beside it.**
  - The other tuned tracker, batch least squares and naive.
  - Every check by gate time as well as pooled (G0 panel, statistics). On these data the settled
    rows at zig + 5 min are mostly rows before the first manoeuvre.
  - T2's calibration.
- **The estimand.** Windows lengthen with the number of manoeuvres, so later gate times
  over-weight busy scenarios. That is the intended estimand, and it is the reference's tuning
  objective too. The speed-change side is predictable from the start speed, a prior a learned
  tracker can use and the IMM cannot. The write-up states both.

## Forecast, recorded before training

- **T1 (learned-gain filter).**
  - Its physics should keep it close to the reference on settled rows: range about 1.05 ×, speed
    about 1.1 × (0.9–1.4).
  - Overall range about 0.95 × (0.85–1.1).
  - P(carried) about 35%, and P(passes G5 | carried) about 50%.
  - Main risks: training stability through 360 filter steps, and a gain network that learns no
    better than the IMM's switching.
- **T2 (LSTM, Gaussian).**
  - Overall range about 0.9 ×, as phases 3 and 3b won after turns.
  - Settled speed about 1.5 × (1.2–2.0), because the networks' straight-leg speed gap has
    persisted for six iterations (3b: 1.15 kt against the IMM's 0.71 kt on held course).
  - P(carried) about 10%.
- **G5 overall.** P(pass) about 20%.
