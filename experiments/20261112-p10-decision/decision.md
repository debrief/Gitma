# Phase 10 decision: T2's range with the fused tracker's velocity at G8 (decision 38)

This record is committed before seed 224's test split is generated for scoring.

**Requirements:** SRD Annex C §C.17 and spec 022 (owner decisions 2026-11-12).

## What is judged

**`hybrid-lstm-gaussian-fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6-c180`**
- **Range and position:** T2's.
- **Course and speed:** the frozen `-g1` fused tracker's (decisions 31 and 32), or T2's where that
  tracker is not converged.

It is compared with:
- **the reference** `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`;
- **the estimator to beat on range** (`beat_estimator`): the fused tracker
  `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`.

T2 (`lstm-gaussian`) is bound by `model_digests`, the same digests as decisions 30, 31 and 35.

## The data

Fresh seed 224 (400,000 scenarios), whose 40,000-scenario test split is generated alone with
`configs/phase7-ranges.json` at a commit after this record. The plan is
`configs/phase4/z/plan.json`:
- **content digest** 195c865b…;
- **header ranges** bound to the phase-7 file.

**Pinning the digest.** To pin it, the split was generated once before this record, at 5bede76
with uncommitted edits, into `data/p10pin`. Its digest was taken and the directory deleted between
20:51:37Z and 20:51:57Z. No tracker, network or gate ran on it.

## What is frozen

- **G8** (`tma-g5 --beat`):
  - G5's five gated checks against the IMM, with limits 1, 1, 1.1, 1.1 and 1.1;
  - hybrid/fused median range over all G5 rows, wholly below 1;
  - each at 97.5%, with a scenario-clustered bootstrap (2,000 resamples, seed 20261011).

  Pass if all six pass, fail if any fails, otherwise inconclusive. A false pass is at most about
  2.5% per look.
- **The re-score:** seed 225 (1,100,000 scenarios, a 110,000-scenario test split, phase-7 ranges),
  with the same names and rules. A false pass is then at most about 5% over both looks.
- **Reported, not gated:**
  - T2, the EKF, batch least squares and naive (`spec019-baselines.mjs`, `spec014-lsq.mjs`);
  - settled rows before any manoeuvre and after one.

## Evidence (seed 217 validation, `experiments/20261112-p10-val/validation.md`)

| | Overall range | Course | Settled range | Settled course | Settled speed |
| --- | --- | --- | --- | --- | --- |
| Hybrid / IMM | 0.730 | 0.906 | 0.787 | 0.865 | 0.887 |

Hybrid/fused range is 0.940 [0.912, 0.969]. Every point and every interval is within its limit.

**Forecast before scoring:** P(G8 pass on seed 224) is about 95%. The weakest check is
hybrid/fused range.

## What a pass would and would not show

A pass shows that, under this error model, T2's range together with a filter's velocity beats both
the frozen IMM and the frozen fused tracker. It does not show:
- one coherent track state;
- an advantage over T2 on range (the ranges are equal) or on overall course (T2 is lower);
- an advantage over the EKF on settled course and speed;
- robustness to other error models.
