# Spec 024: The information limit — Cramér–Rao bounds under realistic bearing error

**Requirements:** SRD §1 (the project's answer), Annex C §C.19 (synthesis); the go/no-go report
(`site/docs/results/go-no-go.mdx`). No gate, and no new data. This is a research check of one claim.

## Goal

The synthesis and the go/no-go report suggest, without testing it, that under realistic bearing
error T2's range is near what the bearings allow. This spec tests that claim against the
Cramér–Rao bound (CRB): the lowest error covariance any unbiased estimator can reach, given the
data and the error model.

## Method

- **Data.** Seed 217's validation split, the one phases 7–11 used. It comes in two forms:
  - realistic error (`configs/phase7-ranges.json`);
  - its clean twin (phase-4 ranges: the same geometry and white noise, with no added error).

  The checks use the G5 rows (σ = 1°, zig + 5/10/15/20 min).
- **The model behind the bound.** Each bearing is the true bearing plus zero-mean Gaussian error.
  - **Covariance.** The error covariance is exactly the generator's:
    `σ²·δᵢⱼ + s_ar²·a_ar^|i−j| + s_b²·a_b^|i−j|`, with `a = exp(−dt/τ)` and the values from
    `configs/phase7-ranges.json`. The clean twin keeps only `σ²·δᵢⱼ`.
  - **Dropped samples** are left out.
  - **The unknowns** are the target's position and velocity offsets, δp and δv, from the true track
    p(t). The fitted track is p(t) + δp + δv·(t − t_k).
- **What the bound means on each slice.**
  - **Before any manoeuvre** (settled rows with no manoeuvre ended): the target has been on
    constant velocity all window. The model is exact there, and this is the bound for an unbiased
    estimator.
  - **After a manoeuvre:** the model assumes the estimator knows the manoeuvre's shape, which it
    does not. That makes it a genie bound, lower than the true one. An estimator above it may still
    be at the true limit; an estimator at or below it is certainly near the limit.
- **Fisher information.** For an estimate from samples 0…k, the information is J = HᵀΣ⁻¹H,
  computed by Cholesky over the valid samples. The CRB is J⁻¹, carried to time k. Range,
  course and speed variances come from it by the delta method.
- **The summary.** On each slice, the median absolute error the bound implies. That is the median
  of the mixture of zero-mean Gaussians with the per-row bound sds. It sits beside each
  estimator's median error on the same rows:
  - the frozen T2 and the retrained T2;
  - the `-g1` IMM and EKF;
  - the fused tracker;
  - batch least squares, run in the script;
  - naive.

  The script also reports how much the realistic error raises the bound: the realistic-to-clean
  ratio of the bound's medians.

## Pre-registered reading (committed before the script is run)

On the before-manoeuvre slice, under realistic error, let ρ = (T2's median range error) / (the
bound's median range error).

| ρ | Reading |
| --- | --- |
| ≤ 1.25 | T2 is near the information limit. The report's claim stands. |
| 1.25–2 | T2 sits partway to the limit. The claim is softened. |
| ≥ 2 | There is substantial room. The claim is withdrawn, and the go/no-go report and synthesis are amended. |

The after-manoeuvre slice is reported with the genie caveat above. A ρ there can confirm "near
the limit", but it cannot show room.

## Caveats stated in advance

- **Prior knowledge.** The CRB bounds unbiased estimators. T2 learned the training distribution,
  which acts as a prior, so it can sit below the CRB where the bearings carry little information.
  A ρ below 1 means T2 is using prior knowledge, not that the bound is wrong.
- **A known error model.** The bound assumes the estimator knows the error statistics. The IMM,
  the EKF and least squares assume white noise.

## Deliverables

- `scripts/research/spec024-crb.mjs`, committed before it is run.
- `experiments/20261115-crb/`: `run.sh`, `crb-real.json`, `crb-clean.json`, `inputs.sha256` and `results.md`.
- **If the reading calls for it,** amendments to the go/no-go report, the synthesis page and SRD §1.
- A site page: an algorithm note on the bound.
