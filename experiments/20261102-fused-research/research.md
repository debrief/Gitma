# Research: a fused tracker (the IMM with T2's range as a measurement)

**Validation only** (seed 211, the 16,463 σ = 1° G5 rows used for decision 29 and spec 013).
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

Smallest margin over the five G5 checks: limits 1 for the overall checks, 1.1 for the settled ones.

| Variant | u = M·k² | Overall range | Overall course | Settled range | Settled course | Settled speed | Settled, before any manoeuvre: range | Margin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| k1 M1 | 1 | 0.876 | 1.063 | 1.010 | 1.355 | 1.280 | 1.398 | −0.232 |
| k2 M6 | 24 | 0.840 | 0.948 | 0.929 | 0.964 | 0.952 | 1.137 | 0.052 |
| k4 M3 | 48 | 0.800 | 0.925 | 0.867 | 0.933 | 0.900 | 1.029 | 0.075 |
| **k4 M6** | 96 | **0.806** | **0.930** | **0.845** | **0.908** | **0.882** | **0.937** | **0.070** |
| k4 M12 | 192 | 0.828 | 0.944 | 0.839 | 0.910 | 0.903 | 0.880 | 0.056 |
| k8 M3 | 192 | 0.818 | 0.943 | 0.838 | 0.907 | 0.889 | 0.884 | 0.057 |
| k16 M6 | 1536 | 0.940 | 0.974 | 0.934 | 0.961 | 0.947 | 0.942 | 0.026 |
| k32 M6 | 6144 | 0.983 | 0.991 | 0.981 | 0.985 | 0.977 | 0.971 | 0.009 |
| Phase-4b hybrid (θ = 45°) | | 0.847 | 0.897 | 0.971 | 0.983 | 0.989 | 1.347 | 0.101 |
| T2 alone | | 0.847 | 0.840 | 0.971 | 1.443 | 1.662 | 1.347 | −0.511 |

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
- **The range NIS is far below 1** (0.054 for k4 M6), so the NIS does not show that R is right. T2's
  errors are correlated in time and with the bearings, so the innovations are small by
  construction. A pass would need a NEES check (state error against the stated covariance) before
  anyone calls the fused covariance honest.
- **Plateau, not a spike.** Variants with u from 48 to 192 all have a margin of 0.056–0.075 and
  settled ratios of 0.84–0.93. The choice of variant matters less than the design.
- **In-sample.** Twelve variants were scored on the same rows. Only a fresh seed (214) under G5
  unchanged would test them.
