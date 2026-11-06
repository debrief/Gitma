# Spec 018 research (validation only, seed 211)

The record is `experiments/20261106-p6-research/`: `calibration.json`, `diagnostic.json` and
`run.sh`.

- **R1 Stated sds by the delta method.** They match a seeded Monte Carlo to within 2% on a small
  covariance (`state-sd.test.ts`). With `-sd` the trackers' estimates are byte-identical; without
  it, so are the rows.
- **R2 The raw sds are miscalibrated, both trackers alike.**

| Output | Fused m50 / m90 | IMM m50 / m90 | Honest Gaussian |
| --- | --- | --- | --- |
| log-range | 0.470 / 1.522 | 0.410 / 1.437 | 0.674 / 1.645 |
| course | 0.292 / 1.647 | 0.298 / 1.691 | |
| speed | 0.172 / 0.683 | 0.182 / 0.719 | |

  **Typical rows.** Errors are much smaller than the stated sd. The reference's ×8 measurement
  inflation and ×4 initial covariance (decision 29) make both filters conservative.
  **The tail.** It is relatively heavier: m90/m50 is 3.2–5.6, against 2.44 for a Gaussian. This
  matches spec 014's NEES finding: too wide on typical rows, with an overconfident tail.
- **R3 Recalibration transfers across scenarios** (two-fold: fit on even-indexed scenarios, judge
  on odd).
  - **Coverage.** Within nominal ± 2 pp on all six, from 48.5% (speed-50) to 50.8% (course-50).
    The 50% checks are "inconclusive" only because the half split's intervals are about
    ±1.3 pp wide.
  - **Width.** The fused tracker is narrower than the IMM on all three outputs: log-range 0.747,
    course 0.940, speed 0.899.
  - **Carried.**
