# Plan: Spec 018 — calibrated uncertainty (gate G7)

## Constitution check (1.3.0)

- **I Types.** `course_sd_rad`, `speed_sd_mps`, `UncertaintyCalibration`,
  `ChangeDecision.calibrations` and G7 are added in schema 0.20.0. The goldens change only in the
  version string.
- **II Determinism.**
  - The sds are a pure function of the filter state.
  - The multipliers are quantiles.
  - The bootstrap and the re-computed sample use the gate's seed.
  - The default rows are byte-identical.
- **III Portability.** Plain functions; one CLI per stage (`tma-track` / `tma-fuse-track` with
  `--report-sd`, then `tma-g7`).
- **IV Baselines.** The baseline is the reference IMM, recalibrated the same way, with its coverage
  reported.
- **V Gates.** Decision 33 precedes the test data. The panel decides the gate.

## Order

1. Code and tests.
2. Validation research and the validation rule.
3. Plan and seed-215 digest.
4. Decision 33.
5. Data after the decision.
6. G7.
7. Panel.
8. Write-up.
