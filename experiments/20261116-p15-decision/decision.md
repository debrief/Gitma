# Phase 15 decision: the EKF-fused tracker at G5 (decision 43)

This record is committed before seed 233's test split is generated for scoring.

**Requirements:** SRD Annex F and spec 028 (owner decision F1, 2026-11-16).

## What is judged

**`fused-lstm-gaussian-ekf-sa0.07-p16-r64-g1-k4-m3`**: the frozen T2's range fused into the EKF
(σa 0.07, P0 × 16, R × 64, guarded initialisation level 1), every 3 samples, k 4.

- **The reference:** the re-tuned EKF `ekf-sa0.03-p16-r64-g1` (Annex E), the reference the
  carried variant's validation margin was smaller against (Annex F §F.3).
- **T2** (`lstm-gaussian`) is bound by `model_digests`, the same as decisions 30–38. The fused
  file is re-computed from its name on a seeded sample (spec 015).

## The data

Fresh seed 233 (400,000 scenarios), whose 40,000-scenario test split is generated alone with
`configs/phase7-ranges.json` at a commit after this record. The plan is
`configs/phase4/x/plan.json` (content digest b4e1a681…, header ranges bound to the phase-7 file).

**Pinning the digest.** To pin it, the split was generated at 65666f4 with uncommitted edits into
`data/p15pin`, twice (19:16:58Z–19:17:16Z with phase-7 heldout ranges, 19:17:22Z–19:17:42Z with
the plan's own, same digest). Its digest was taken and the directory deleted each time. No
tracker, network or gate ran on it.

## What is frozen

- **G5** (`tma-g5`): five gated checks against the EKF (overall range and course, limit 1; settled
  range, course and speed, limit 1.1), each at 97.5% with a scenario-clustered bootstrap (2,000
  resamples, seed 20261011). Pass if all pass, fail if any fails, otherwise inconclusive.
- **The re-score:** seed 234 (1,100,000; a 110,000-scenario test split), same names and rules. A
  fail or inconclusive there is final.
- **Reported, not gated:** the re-tuned IMM `imm-cv0-ct0.03-w0.01-s0.001-p32-r64-g1`, Annex E's
  best IMM fusion (`…-p32-r64-g1-k4-m12`), T2, batch least squares and naive.

## Evidence (seed 217 validation, `experiments/20261116-p15-val/validation.md`)

| | Overall range | Course | Settled range | Settled course | Settled speed |
| --- | --- | --- | --- | --- | --- |
| EKF-fused / EKF | 0.790 | 0.798 | 0.867 | **1.083 [0.997, 1.169]** | 1.024 |
| EKF-fused / IMM (reported) | 0.825 | 0.983 | 0.882 | 0.767 | 0.868 |

**Forecast before scoring:** P(pass on seed 233) about 10%, P(fail) under 5%, otherwise
inconclusive; P(pass over both looks) about 25%. The binding check is settled course: its interval
should narrow to about ±0.04, and the point was selected from 96 variants on the same split.

## What a pass would and would not show

A pass shows that, under this error model, the EKF with T2's range beats the re-tuned EKF on range
and course overall and is within 1.1 × of it after a manoeuvre. It would not show an advantage over
the re-tuned IMM on overall course (0.98 × on validation, ungated), nor over T2 on course.
