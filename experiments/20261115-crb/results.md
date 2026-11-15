# Spec 024: the information limit, in Cramér–Rao bounds

**Data.** Seed 217's validation split: 16,711 G5 rows in 4,995 scenarios. It comes with realistic
bearing error and as its clean twin. The inputs are the predictions from
`experiments/20261114-p11-val/` (hashes in `inputs.sha256`). The spec, the script and `run.sh`
were committed in 593ecc6, before the run. No row had a singular information matrix.

**Reading: ρ = 1.51, so the claim is softened.** On straight legs under realistic error, T2's
median range error is 1.51 × the bound. Batch least squares reaches the bound there, so T2 is not
near the information limit on these rows. On rows after a manoeuvre, only a genie bound can be
computed, which says nothing about room for improvement (spec §Method).

## Before any manoeuvre (settled; the bound is exact; n = 4,205)

| Median error | Range | × bound | Course | × bound | Speed | × bound |
| --- | --- | --- | --- | --- | --- | --- |
| **Bound, realistic error** | **6.86%** | 1 | **2.05°** | 1 | **0.83 kt** | 1 |
| Batch least squares | 6.89% | **1.00** | 1.99° | 0.97 | 0.83 kt | 1.01 |
| Fused tracker | 9.40% | 1.37 | 8.96° | 4.4 | 1.56 kt | 1.9 |
| EKF | 10.22% | 1.49 | 5.16° | 2.5 | 1.33 kt | 1.6 |
| **T2 (frozen)** | **10.38%** | **1.51** | 15.35° | 7.5 | 2.42 kt | 2.9 |
| T2 retrained | 10.83% | 1.58 | 12.77° | 6.2 | 2.41 kt | 2.9 |
| IMM | 11.46% | 1.67 | 9.76° | 4.8 | 1.78 kt | 2.2 |
| Naive | 39.78% | 5.8 | 86.5° | 42 | 4.20 kt | 5.1 |
| **Bound, clean twin** | **2.43%** | 1 | **0.69°** | 1 | **0.29 kt** | 1 |
| Batch least squares | 2.50% | 1.03 | 0.69° | 1.00 | 0.30 kt | 1.03 |
| EKF | 3.50% | 1.44 | 1.81° | 2.6 | 0.49 kt | 1.7 |
| IMM | 4.00% | 1.65 | 3.90° | 5.7 | 0.66 kt | 2.3 |
| T2 (frozen) | 6.12% | 2.52 | 8.00° | 11.6 | 2.04 kt | 7.0 |
| T2 retrained | 8.29% | 3.42 | 9.39° | 13.6 | 2.30 kt | 7.9 |

## After a manoeuvre (a genie bound, lower than the true one; n = 12,031)

| Median error | Range | × genie bound | Course | Speed |
| --- | --- | --- | --- | --- |
| Genie bound, realistic error | 5.79% | 1 | 2.53° | 0.44 kt |
| T2 (frozen) | 12.92% | 2.23 | 30.3° | 3.06 kt |
| Fused tracker | 14.47% | 2.50 | 37.7° | 3.12 kt |
| IMM | 19.12% | 3.30 | 40.0° | 3.29 kt |
| Batch least squares | 24.41% | 4.22 | 67.8° | 3.39 kt |

All rows, realistic error: the bound is 6.09%, T2 12.16% (2.00 ×) and the fused tracker 12.95%. The
full tables are in `crb-real.json` and `crb-clean.json`.

## What it shows

1. **The script is right where it can be checked.** On straight legs, batch least squares, which is
   efficient for this model, matches the exact bound within 3% on every output in both forms of
   the data.
2. **The bias costs a lot of information.** On straight legs it raises the bound 2.8 × in range
   (2.43% to 6.86%) and 3.0 × in course. That information is gone for every estimator.
3. **T2's robustness is mostly slack.** T2's straight-leg range degrades 1.7 × (6.12% to 10.38%)
   while the bound degrades 2.8 ×. T2 degrades less because it starts 2.5 × above the bound on clean
   data, not because it extracts what the filters miss. Least squares, at the bound, degrades
   exactly as the bound does.
4. **On straight legs, T2 is not at the limit.** Least squares reaches the bound under realistic
   error, and T2 is 1.51 × above it. The retrained T2 (1.58 ×) did not close the gap either.
5. **After manoeuvres, the question stays open.** T2 is 2.2 × above a bound that assumes the
   manoeuvre is known. The true bound lies somewhere between the two, so these rows can neither
   confirm nor refute that T2 is near the limit.
6. **Course and speed are far from the bound** for every recursive estimator, learned or
   classical (2–12 ×). Only least squares reaches it on straight legs.

## Consequence for the project's answer

- **Withdrawn:** "T2 sits near what this data allows". On straight legs it does not.
- **Supported:** "the bias removes information". It does: about 2.8 × on range.
- **Unchanged and strengthened:** the stand-alone no-go. Even under realistic error, a classical
  batch solver is at the bound on straight legs, where T2 is 1.5 × above it.
- **The "go" stays qualified.** After manoeuvres, nothing reaches the genie bound. Whether a
  better learned estimator could approach the limit there is the open question.

## Caveats

- **The bound is for unbiased estimators.** Learned models carry a prior from training, so they
  could beat it where the data are weak. On these slices none does.
- **The bound assumes the error statistics are known.** The script used the generator's exact
  covariance. Least squares, which assumes white noise, still reaches it on straight legs, so the
  correlation costs little efficiency there.
- **One error model, one seed, validation data.**
