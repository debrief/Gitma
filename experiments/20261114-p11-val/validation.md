# Phase 11 validation: T2 retrained on realistic bearing error (spec 023, SRD Annex C §C.18)

**Result: not carried, so phase 11 stops at validation.** The retrained T2's median range error is
not below the frozen T2's: the ratio is 1.021 [0.991, 1.052]. Seed 227 is never generated, and no
G8 is scored.

**Data.** Seed 217's 10,000-scenario validation split with realistic bearing error
(`configs/phase7-ranges.json`), the split phases 7–10 used. That gives 16,711 G5 rows in 4,995
scenarios, of which 7,509 are settled.

**Models.**
- **Retrained T2** (`lstm-gaussian-re`, `experiments/20261113-p11a-models/`). It was trained on seed
  226 (phase-7 ranges, run 43388324281). Early stopping chose epoch 48 of 55 (validation NLL
  −8.225). Its normalisation comes from seed 226's train split.
- **Frozen T2** (`lstm-gaussian`, `experiments/20261101-p4b-models/`). Its normalisation comes from
  seed 211's train split.

**Pre-registration.** `run.sh` was committed (91a10cb) after the model and before any scoring.
Hashes are in `predictions.sha256`.

## The diagnostic (`g8/`; the carry rule needs all six points within their limits)

| Check | Point | 97.5% CI | Limit | Point within |
| --- | --- | --- | --- | --- |
| Range / IMM | 0.745 | [0.718, 0.774] | < 1 | yes |
| Course / IMM | 0.857 | [0.829, 0.885] | < 1 | yes |
| Settled range / IMM | 0.804 | [0.760, 0.852] | < 1.1 | yes |
| Settled course / IMM | 1.079 | [1.018, 1.139] | < 1.1 | yes |
| Settled speed / IMM | 1.073 | [1.015, 1.130] | < 1.1 | yes |
| **Range / frozen T2** (g8-range-vs-network) | **1.021** | [0.991, 1.052] | < 1 | **no** |

The machine result is `inconclusive`. Under the carry rule, the range point against the frozen T2
fails.

## Retrained against frozen T2 (`baselines.json`, paired, 97.5%)

| Rows | Range | Course | Speed |
| --- | --- | --- | --- |
| All G5 rows | 1.021 [0.991, 1.052] | 0.981 [0.959, 1.003] | 0.989 [0.966, 1.014] |
| Settled | 1.021 [0.979, 1.064] | **0.878** [0.847, 0.910] | 0.977 [0.946, 1.011] |
| Settled, before any manoeuvre | 1.044 [0.974, 1.109] | **0.832** [0.791, 0.879] | 0.997 [0.953, 1.040] |
| Settled, after a manoeuvre | 0.996 [0.942, 1.048] | 0.964 [0.916, 1.011] | 0.969 [0.921, 1.017] |

On realistic error, retraining does not change range. It improves only settled course, mostly on
straight legs before any manoeuvre.

## The clean twin (`clean.json`, `baselines-clean.json`; the same rows with white noise only)

| Median range error | Clean | Realistic | Realistic / clean |
| --- | --- | --- | --- |
| Retrained T2 | 10.3% | 12.4% | 1.21 [1.18, 1.24] |
| Frozen T2 | 8.0% | 12.2% | 1.52 [1.47, 1.56] |
| `-g1` IMM | 9.1% | 16.7% | |

- **Retraining costs a lot on white noise.** On the clean twin, retrained/frozen is 1.287
  [1.244, 1.331] on range, 1.132 on course and 1.061 on speed. It is 1.304 on settled range.
- **The retrained T2 looks more robust, but only by starting worse.** It degrades 1.21 × under the
  error against the frozen T2's 1.52 ×. It ends at the same realistic range error, because its
  clean error is higher.
- **On the clean twin the retrained T2 is worse than the IMM on range** (10.3% against 9.1%).

## Baselines on the realistic split (median, all G5 rows / settled)

| Estimator | Range | Course | Speed |
| --- | --- | --- | --- |
| Retrained T2 | 12.4% / 12.1% | 24.6° / 15.5° | 2.84 / 2.58 kt |
| Frozen T2 | 12.2% / 11.9% | 25.1° / 17.7° | 2.87 / 2.64 kt |
| Fused tracker on the retrained T2 | 13.0% / 11.8% | 26.6° / 12.8° | 2.62 / 2.13 kt |
| Fused tracker on the frozen T2 | 13.0% / 11.7% | 26.5° / 12.6° | 2.63 / 2.14 kt |
| Hybrid (θ 180) on the retrained T2 | 12.4% / 12.1% | 26.3° / 12.7° | 2.60 / 2.12 kt |
| Hybrid (θ 180) on the frozen T2 | 12.2% / 11.9% | 26.0° / 12.4° | 2.61 / 2.13 kt |
| `-g1` IMM | 16.7% / 15.1% | 28.7° / 14.4° | 2.82 / 2.40 kt |
| `-g1` EKF | 16.1% / 14.3% | 29.7° / **9.8°** | **2.40 / 1.91 kt** |
| Batch least squares (`lsq.json`) | 17.1% / 13.1% | 46.0° / 7.1° | 2.41 / 1.70 kt |
| Naive | 38.7% / 39.5% | 88.3° / 88.4° | 3.92 / 4.10 kt |

- **The fused tracker and the hybrid are unchanged** when rebuilt on the retrained T2: every
  median is within 0.3 pp, 0.4° and 0.03 kt.
- **Before any manoeuvre, batch least squares is best:** 6.9%, 2.0° and 0.83 kt on settled rows.
- **The EKF is still best on settled course and speed.**

## Reading

- **Training on the error did not help range.** Under realistic error the retrained T2 has the
  same range error as the frozen T2, to within ±3–5%. On white noise it is 29% worse.
- **This suggests the frozen T2's range error under this error model is near what this
  architecture and data size can reach.** A drifting bias of 0.5° is close to unobservable
  (phase 9), and the network cannot learn what the bearings do not contain.
- **Limits.**
  - There is one training seed, so the variance across training runs is unknown.
  - It covers one error model at one severity, on validation only.
  - The retrained model stopped at epoch 48. It was not tuned, and its configuration is T2's.
  - The carry rule judges points, not intervals. The interval [0.991, 1.052] also excludes a gain
    of more than 1%.

**Next: the owner decides.** Phase 10's verdict stands.
