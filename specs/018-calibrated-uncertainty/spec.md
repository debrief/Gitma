# Spec 018: Phase 6 — calibrated uncertainty (gate G7)

**Requirements:** SRD Annex C §C.6 item 2 and §C.13 (owner decisions 2026-11-06); decision 32.

## Goal

Judge whether the fused tracker that passed G5, once its stated uncertainty is recalibrated post
hoc, gives intervals that cover their nominal level and are narrower than the reference IMM's,
recalibrated the same way. No training.

## Functional requirements

- **FR-001 Stated sds (opt-in, `-sd`).** `ImmParams.reportSd` writes `log_range_sd`,
  `course_sd_rad` and `speed_sd_mps` (schema 0.20.0) on every converged row. They come from the
  combined covariance by the delta method (`stateSds`).
  - The estimates and the default rows are unchanged (golden).
  - The flag is `--report-sd` on `tma-track` and `tma-fuse-track`, and the parsers round-trip it.
- **FR-002 Scoring** (`gate-g7.ts`):
  - z = |error| / sd per output on the G5 rows; a row with no estimate has z = +∞;
  - multipliers m50 and m90, the quantiles of z;
  - coverage checks (six, gated for the tracker; reported for the reference);
  - width checks (three: median 90% width ratio).
- **FR-003 `tma-g7`.**
  - **Validation:** a full fit (`calibration.json`) and a two-fold out-of-sample diagnostic
    (`diagnostic.json`).
  - **Test:** G5's bindings (spec 015), the decision's frozen `calibrations` (schema 0.20.0
    `UncertaintyCalibration`), a re-computed sample, and scored once. It writes `verdict.json`
    and `scoring.json`.
- **FR-004 Research, decision and gate.**
  - Seed-211 validation (`experiments/20261106-p6-research/`).
  - Decision 33 freezes the multipliers, plan `configs/phase4/u` and fresh seed 215.
  - G7 is scored on seed 215 with data generated after decision 33, then goes to the agent panel.

## Out of scope

- Training.
- Regime-dependent multipliers: the regime is not known at run time.
- Changing either tracker's estimates.
