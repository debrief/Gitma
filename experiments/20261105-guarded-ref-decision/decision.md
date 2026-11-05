# Decision 32: the reference trackers use the guarded initialisation (level 1)

Owner decision, 2026-11-05. It follows spec 015 research R5 and spec 016. No gate is judged and no
test split is touched.

## Decision

- **From this decision on, every reference tracker under SRD Annex C uses guarded initialisation
  level 1** (`-g1`, spec 016), with decision 29's tuning unchanged:
  - reference: **`imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`**;
  - reported beside it: `ekf-sa0.03-p4-r8-g1`;
  - a fused tracker built on the reference uses the `-g1` IMM:
    `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`.
- **Level 2 (`-g2`) is rejected.**
- **Decisions 29–31 and their verdicts stand.** Phase 4b's and phase 4c's G5 passes were judged
  against the level-0 IMM and are not re-scored. Their decision records keep naming it.
  `tma-g5` and every frozen name still reproduce them byte for byte.

## Why

- **The defect (spec 015 R5).** After target manoeuvres, the frozen re-initialisation fits a
  constant-velocity batch solution through every bearing so far. That fit can be degenerate: its
  track passes through ownship's position at sample 0, and JᵀJ has a condition number of about
  10¹⁶. The initial covariance σ²(JᵀJ)⁻¹ is then not positive definite. On seed 214's test split
  that happens in 87 of 44,343 initialisations, in 43 of 40,000 scenarios.
- **The fix (spec 016, level 1).**
  - It refuses a fit whose track comes within 100 m of ownship, or whose QR factor is
    ill-conditioned; the tracker retries every 6 samples.
  - It builds P₀ in square-root form, positive definite by construction, and equal to the frozen
    P₀ to rounding on a healthy fit.
- **Evidence (seed-211 validation, `experiments/20261103-guarded-init-val/`):**

| Level 1 / level 0, G5 rows | Overall range | Overall course | Settled range | Settled course | Settled speed |
| --- | --- | --- | --- | --- | --- |
| IMM | 1.000 [0.998, 1.001] | 1.002 [0.999, 1.004] | 1.000 [0.997, 1.003] | 1.000 [0.997, 1.000] | 1.001 [1.000, 1.004] |
| EKF | 1.000 [0.998, 1.001] | 1.001 [0.999, 1.004] | 1.001 [1.000, 1.003] | 1.001 [1.000, 1.005] | 1.000 [1.000, 1.000] |
| Fused | 1.000 [0.998, 1.002] | 1.000 [1.000, 1.004] | 0.999 [0.996, 1.000] | 1.000 [1.000, 1.000] | 1.000 [0.995, 1.000] |

  The IMM has no non-positive-definite covariance at any step at level 1. At level 0 it has 21
  such steps, in 6 of 10,000 scenarios. The cost is 0.07% more rows with no estimate, which G5
  already scores as infinite error.
- **No re-tune.** The tuning objective, median range error over the G5 rows, is unchanged at
  level 1 (1.000 [0.998, 1.001]). Re-tuning would change the reference without evidence that it
  helps.

## Consequences

- **Pre-registration.** A decision record written after this one names the `-g1` reference. A
  gate's `reference_estimator` and the files it is given must match it. `tma-g5` re-computes `-g1`
  files from their names (spec 015, spec 016 FR-003).
- **Comparisons with phases 4b and 4c.** Any later comparison with their results must state that
  their reference was level 0. On validation the two levels are equivalent to within ±0.3%.
- **The seeds stay reserved.** Seeds 211–214 are not re-used for any gate; fresh seeds run from 215.

## Known limits

- **Validation only.** The equivalence is shown on seed-211 validation. It is not a test-split
  result, and no gate depends on it.
- **The thresholds were set before measurement, not tuned.** They are 100 m (the generator's
  minimum range) and 10⁷ on the QR conditioning estimate.
