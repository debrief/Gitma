# Phase 7 decision: the frozen fused tracker under realistic bearing error (decision 35)

This record is committed before seed 218's test split is generated for scoring.

Requirements: SRD Annex C §C.14 and spec 019. On 2026-11-08 the owner decided:
- frozen trackers;
- a Gauss–Markov term plus a drifting bias, at doubled severity;
- G5's rules unchanged.

## What is judged

**`fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`**: decision 31's fused
tracker (k 4, every 6 samples) built on decision 32's guarded reference. It is judged against
**`imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`**.

- **T2** is `lstm-gaussian`, from `experiments/20261101-p4b-models/models/tracker`, bound by file
  digest (`model_digests`, the same as decisions 30 and 31). Its derived features use seed 211's
  normalisation.
- **The prediction chain and the 200-scenario recomputation** are spec 015's, as in `tma-g5`.

## The data

Fresh seed 218, a 400,000-scenario dataset whose 40,000-scenario test split is generated alone with
`configs/phase7-ranges.json` (generator 0.6.0). Plan `configs/phase4/w/plan.json`:
- **content digest** 536a8677…, checked by the plan and by `tma-g5`;
- **header ranges** must equal the phase-7 file (spec 019 R2).

The data are generated at a commit after this record.

**Pinning the digest.** To pin it, the split was generated once before this record, at 192d124
with uncommitted edits, into `data/p7pin`. Its digest was taken and the directory deleted between
19:53:56Z and 19:54:15Z. No tracker, network or gate ran on it.

## What is frozen

- **The gate.** G5 exactly as in Annex C §C.5:
  - σ = 1° rows at zig + 5/10/15/20 min;
  - overall range and course wholly below 1 × the IMM;
  - settled range, course and speed wholly below 1.1 ×;
  - 97.5% scenario-clustered intervals (2,000 resamples, seed 20261011).

  Pass if every gated check passes, fail if any fails, otherwise inconclusive. A false pass is at
  most about 2.5% per look.
- **The re-score** if the result is inconclusive: seed 219 (1,100,000 scenarios, a
  110,000-scenario test split, phase-7 ranges), with the same names, models and rules. A false pass
  is then at most about 5% over both looks.
- **Reported, not gated:**
  - the EKF (`ekf-sa0.03-p4-r8-g1`);
  - settled rows before any manoeuvre and after one;
  - the clean comparison by `scripts/research/spec019-clean.mjs`, as in §C.14. Seed 218's
    phase-4-range twin is generated only after the verdict is committed.

## Evidence (seed 217 validation, `experiments/20261108-p7-val/validation.md`)

| Fused / IMM | Overall range | Overall course | Settled range | Settled course | Settled speed |
| --- | --- | --- | --- | --- | --- |
| Realistic error | 0.777 | 0.922 | 0.778 | 0.876 | 0.889 |
| Clean twin | 0.844 | 0.932 | 0.880 | 0.943 | 0.897 |

**Carried.** Every point estimate is within its limit, as the carry rule requires, and every 97.5%
interval is too.

**The clean comparison.** Every tracker's median range error is 1.7–1.8 × its clean value. The
fused tracker degrades least: the interaction is 0.920 [0.888, 0.954].

**Forecast before scoring:** P(G5 pass on seed 218) about 95%. The weakest check is overall course;
its validation upper bound was 0.942.

## What a pass would and would not show

A pass shows that the fused tracker's advantage over the IMM survives this one error model at this
one severity, frozen. It does not show:
- robustness to other models or severities, or to real data;
- that either tracker handles correlated error well: both degrade by 1.7–2 ×;
- anything about the mechanism.
