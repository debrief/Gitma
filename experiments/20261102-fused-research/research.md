# Research: a fused tracker (the IMM with T2's range as a measurement)

**Validation only:** seed 211, the σ = 1° G5 rows used for decision 29 and spec 013. The script drops non-converged rows, leaving 16,463 rows; `tma-g5` scores them as infinite, over 16,500 rows in 4,951 scenarios.
Nothing here is gated. Every variant was chosen in-sample on these rows.

**Script:** `scripts/research/spec014-fused.mjs`, which writes the `grid-*.json` files.

## Design

- **Base filter.** The frozen reference IMM (decision 29) is unchanged.
- **Extra measurement.** After each bearing update, every M samples, it gets T2's range as a
  log-range measurement:
  - z = ln(range_T2), h = ln ρ;
  - R = (k · log_range_sd)², where log_range_sd is T2's own stated sd;
  - the update is applied to both models (Joseph form);
  - model probabilities are left to the bearings.
- **One track state.** Range, course and speed come from a single state, unlike the phase-4b hybrid.
- **No training.** Both estimators are frozen.

## Grid: ratio of medians to the IMM, on the same rows

All **18** variants scored, in two stages: k ∈ {1, 2, 4} × M ∈ {1, 6, 30}, then a refinement
around the first stage's best (k ∈ {4, 8, 16, 32}). The smallest margin is taken over the five G5
checks, with limits of 1 for the overall checks and 1.1 for the settled ones.

*Corrected after decision 31 (G5 panel round 1):* decision 31, Annex C §C.11 and earlier versions of
this note said "12 variants" and described the plateau by u = M·k². Both were wrong. There were 18
variants, and u does not order them: k2 M30 has u = 120 but a margin of 0.049.

| Variant | Overall range | Overall course | Settled range | Settled course | Settled speed | Settled, before any manoeuvre: range | Margin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| k1 M1 | 0.876 | 1.063 | 1.010 | 1.355 | 1.280 | 1.398 | −0.232 |
| k1 M6 | 0.876 | 0.991 | 1.004 | 1.117 | 1.054 | 1.325 | −0.015 |
| k1 M30 | 0.974 | 0.971 | 1.057 | 1.043 | 1.072 | 1.296 | 0.025 |
| k2 M1 | 0.868 | 0.988 | 0.993 | 1.122 | 1.063 | 1.345 | −0.020 |
| k2 M6 | 0.840 | 0.948 | 0.929 | 0.964 | 0.952 | 1.137 | 0.052 |
| k2 M30 | 0.871 | 0.951 | 0.892 | 0.953 | 0.943 | 0.978 | 0.049 |
| k4 M1 | 0.841 | 0.937 | 0.929 | 0.977 | 0.948 | 1.188 | 0.063 |
| k4 M3 | 0.800 | 0.925 | 0.867 | 0.933 | 0.900 | 1.029 | 0.075 |
| **k4 M6** | **0.806** | **0.930** | **0.845** | **0.908** | **0.882** | **0.937** | **0.070** |
| k4 M12 | 0.828 | 0.944 | 0.839 | 0.910 | 0.903 | 0.880 | 0.056 |
| k4 M30 | 0.903 | 0.962 | 0.896 | 0.948 | 0.923 | 0.918 | 0.038 |
| k8 M3 | 0.818 | 0.943 | 0.838 | 0.907 | 0.889 | 0.884 | 0.057 |
| k8 M6 | 0.856 | 0.959 | 0.861 | 0.933 | 0.908 | 0.887 | 0.041 |
| k8 M12 | 0.899 | 0.967 | 0.898 | 0.948 | 0.927 | 0.928 | 0.033 |
| k16 M3 | 0.902 | 0.966 | 0.904 | 0.945 | 0.929 | 0.933 | 0.034 |
| k16 M6 | 0.940 | 0.974 | 0.934 | 0.961 | 0.947 | 0.942 | 0.026 |
| k16 M12 | 0.969 | 0.979 | 0.963 | 0.972 | 0.962 | 0.959 | 0.021 |
| k32 M6 | 0.983 | 0.991 | 0.981 | 0.985 | 0.977 | 0.971 | 0.009 |
| Phase-4b hybrid (θ = 45°) | 0.847 | 0.897 | 0.971 | 0.983 | 0.989 | 1.347 | 0.101 |
| T2 alone | 0.847 | 0.840 | 0.971 | 1.443 | 1.662 | 1.347 | −0.511 |

The best region is k = 4 with M from 1 to 12, together with k8 M3: margins 0.056–0.075. k4 M6 is
in its middle; it is not the argmax (k4 M3 is, at 0.075). Across neighbouring variants the
before-manoeuvre ratio ranges from 0.88 to 1.19.

All variants are in the `grid-*.json` files. The IMM recomputed by the script is the "imm" entry.
It matches decision 29's medians to within float32 storage rounding: 9.24% range, 23.05° against 23.04° course, 1.912 against 1.911 kt speed.

## Medians (k4 M6)

| Estimator | All: range | course | speed | Settled: range | course | speed | Before a manoeuvre: range | After: range |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fused k4 M6 | 7.45% | 21.4° | 1.69 kt | 6.10% | 6.75° | 1.15 kt | 3.89% | 10.6% |
| IMM | 9.24% | 23.0° | 1.91 kt | 7.22% | 7.43° | 1.30 kt | 4.15% | 15.1% |
| Hybrid | 7.83% | 20.7° | 1.90 kt | 7.01% | 7.30° | 1.29 kt | 5.59% | 9.69% |
| EKF (validation report) | 9.72% | 27.7° | 1.73 kt | 7.11% | 5.16° | 1.08 kt | | |

## Reading it critically

- **What it fixes, on validation.**
  - The hybrid's range deficit before any manoeuvre: 0.94 × the IMM, where the hybrid is 1.35 ×.
  - Settled course and speed beat the IMM by estimation (0.91 ×, 0.88 ×), not by copying the IMM's
    output.
  - Range and velocity come from one state.
- **What it gives up.**
  - Overall course: 0.93 ×, against the hybrid's 0.90 ×.
  - Range after a manoeuvre: 10.6%, against the hybrid's 9.7%.
  - By spec 013's criterion (the largest smallest margin), the hybrid still ranks first: 0.101
    against 0.070.
- **Against the EKF** it would still fail settled course: 1.31 × (the hybrid was 1.44 ×). Speed is
  1.06 × and range 0.86 ×.
- **The range NIS is far below 1** (0.054 for k4 M6). Most of that is by design: with R inflated by
  k², a calibrated, independent T2 would give a NIS of about 1/k² (0.0625 at k = 4). The grid also
  shows correlation: at k = 1 the NIS rises from 0.23 at M1 to 0.50 at M30. The NIS does not show
  that R is right. (Corrected, panel round 1.)
- **NEES** (`nees-*.json`): the 4-state error (x, y, vx, vy) against the stated covariance, on the
  same G5 rows. If the covariance is honest, the mean is 4, the median 3.36 and 95% of rows fall
  below 9.49.

  | Estimator | Mean | Median | Within 95% | Settled: mean | median | within 95% |
  | --- | --- | --- | --- | --- | --- | --- |
  | IMM (reference) | 94.2 | 0.99 | 92.5% | 74.6 | 0.35 | 96.2% |
  | Fused k4 M6 | 69.9 | 1.12 | 94.0% | 70.2 | 0.44 | 97.4% |
  | Fused k4 M3 | 52.7 | 1.34 | 93.6% | 38.7 | 0.57 | 97.0% |
  | Fused k8 M3 | 64.1 | 1.02 | 94.1% | 68.1 | 0.38 | 97.4% |

  **Neither filter's covariance is a calibrated uncertainty.**
  - On typical rows it is too wide: the median is about a third of 3.36.
  - It has an overconfident tail: means of 50–100, dominated by a few rows. It is not shown which
    rows these are.
  - The reference's inflation (measurement variance × 8, initial covariance × 4) gives headroom
    that could hide double counting. The settled median NEES rose with the fusion, from 0.35 to 0.44,
    while the error fell: the covariance shrank faster than the error.

  The claim is only this: against the nominal bounds the fused filter is no worse than the IMM.
  That may be masked by the reference's inflation. Its stated uncertainty should not be reported as
  calibrated. (Corrected, panel round 1.)
- **A broad region, not a spike.** k = 4 with M from 1 to 12, and k8 M3, all have a margin of
  0.056–0.075. Weaker or stronger fusion (k ≤ 2 or k ≥ 16, or M = 30) falls away.
- **In-sample.** 18 variants were scored on the same rows, adaptively in two stages. Only a fresh seed (214) under G5
  unchanged would test them.
