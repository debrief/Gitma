# Phase 10 validation: T2's range with the fused tracker's velocity (spec 022, SRD Annex C §C.17)

**Carried:** every one of the six point estimates is within its limit, and so is every 97.5%
interval.

**Data and command.** `tma-g5 --beat` diagnostic on seed 217's 10,000-scenario validation split
with realistic bearing error, generated clean at 5bede76 (`run.sh`, committed before scoring).
Results are in `g8/` and `baselines.json`, and hashes in `predictions.sha256`.

**The estimator.**
`hybrid-lstm-gaussian-fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6-c180`:
T2's range, with the frozen fused tracker's course and speed.

| Check | Hybrid / reference | 97.5% CI | Limit |
| --- | --- | --- | --- |
| Overall range / IMM | 0.730 | [0.704, 0.758] | < 1 |
| Overall course / IMM | 0.906 | [0.884, 0.930] | < 1 |
| Settled range / IMM | 0.787 | [0.745, 0.835] | < 1.1 |
| Settled course / IMM | 0.865 | [0.831, 0.897] | < 1.1 |
| Settled speed / IMM | 0.887 | [0.851, 0.928] | < 1.1 |
| **Overall range / fused tracker** | **0.940** | [0.912, 0.969] | < 1 |

**Median errors on all G5 rows** (16,711 rows):

| Estimator | Range | Course | Speed | Non-converged rows |
| --- | --- | --- | --- | --- |
| Hybrid | 12.2% | 26.0° | 2.61 kt | 0 |
| Fused tracker | 13.0% | 26.5° | 2.63 kt | 130 |
| T2 | 12.2% | 25.1° | 2.87 kt | 0 |
| IMM | 16.7% | 28.7° | 2.82 kt | 151 |
| EKF | 16.1% | 29.7° | 2.40 kt | 92 |

**Reading.**
- **Overall,** the hybrid keeps T2's range and roughly the fused tracker's velocity. Where the
  fused tracker is not converged, the row is T2's, so every row has an estimate.
- **On settled rows** the fused tracker is slightly better on range (11.7% against 11.9%). The
  EKF stays best on settled course (9.8° against 12.4°) and speed.
- **T2 alone** has a lower overall course error (25.1° against 26.0°).
- **The hybrid is not one coherent track state:** range and velocity come from different
  estimators.
