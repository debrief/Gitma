# Spec 016: Guarded (re-)initialisation for the EKF and IMM

**Requirements:** SRD Annex B §B.3 and Annex C §C.3 (the trackers: initialised from the batch
solution), constitution 1.3.0 II (determinism, frozen references reproduce). It follows up on spec
015 research R5, the reference IMM's non-positive-definite covariance.

## Problem

`ekfInitialise` (used by both trackers, first initialisation and re-initialisation) takes the batch
least-squares fit over every bearing so far and sets P₀ = p0Scale · σ²(JᵀJ)⁻¹.
- **The fit can be degenerate.** After target manoeuvres, the straight track it fits can pass
  through ownship's position at an earlier sample.
- **JᵀJ is then swamped by one row.** That sample's Jacobian row ∝ 1/ρ dominates, and the
  condition number of JᵀJ reaches about 10¹⁶.
- **The covariance is not positive definite.** On seed 214's test split this happens in 87 of
  44,343 (re-)initialisations, in 43 of 40,000 scenarios (spec 015 R5).

## Owner decision (2026-11-03)

The fix is **opt-in under a new estimator name**. Every frozen reference (decisions 26 and 29–31)
keeps its name and its rows byte for byte. Committed verdicts still re-score, and `tma-g5` still
re-computes the frozen files. The fix is measured against the frozen IMM on seed-211 validation and
reported. No gate is judged and no reference is re-frozen.

## Functional requirements

- **FR-001 Guarded initialiser (level 1, name suffix `-g1`).** `ekfInitialiseGuarded` uses the
  same batch fit and returns null (the tracker retries every `EKF_REINIT_EVERY` samples) when:
  - there is no batch solution, or the state is implausible at tᵢ (as now);
  - the fitted track comes within `MIN_FIT_RANGE_M` (100 m, the generator's minimum range) of
    ownship at any fitted sample;
  - the Householder QR factor R of the Jacobian is too ill-conditioned: max|R_kk| / min|R_kk| >
    `MAX_FIT_CONDITION` (10⁷, about 10¹⁴ for JᵀJ).

  P₀ = σ²·p0Scale · R⁻¹R⁻ᵀ, with the Jacobian parameterised at tᵢ. JᵀJ is never formed or
  inverted, and P₀ is S Sᵀ, so it is positive definite by construction. On a healthy fit it equals
  the frozen P₀ to rounding.
- **FR-002 Recent-window re-initialisation (level 2, `-g2`).** As level 1, but a
  re-initialisation (not the first initialisation at the zig) first fits only the last
  `REINIT_WINDOW` samples (60, 10 min). It falls back to all samples if that fit is refused.
- **FR-003 Opt-in everywhere.**
  - `TrackerScales.guardedInit` and `ImmParams.guardedInit` take 0 (the default), 1 or 2.
  - The name suffix is `-g1` or `-g2`, after the scales.
  - The flag is `--guarded-init 1|2` on `tma-track` and `tma-fuse-track`.
  - `parseImmName` and `parseEkfName` round-trip the suffix, so `tma-g5` can re-compute a guarded
    tracker.
- **FR-004 Level 0 unchanged.**
  - The golden tracker rows (`seed1-trackers.ndjson`) are byte-identical.
  - An explicit level 0 equals the default.
  - Spec 015's G5 regression is unaffected: the frozen names are unchanged.
- **FR-005 Measurement (report only).** On the seed-211 validation split, `tma-g5` as a
  diagnostic compares, over the G5 rows:
  - IMM-g1 and IMM-g2 against the frozen IMM;
  - the EKF variants against the frozen EKF;
  - the fused tracker on IMM-g1 and IMM-g2 against the frozen fused tracker.

  It also counts the non-PD steps and the non-converged rows for each level. Results go in
  `research.md` and `experiments/<id>/`.

## Out of scope

- Changing any frozen reference, or re-tuning: a new reference needs a decision record.
- Judging any gate. This touches no test split.
- A Cholesky diagnostic inside `immStep`. It is measured offline by
  `scripts/research/spec015-imm-covariance.mjs count <split> [level]`.
