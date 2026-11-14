# Spec 023: Phase 11 — T2 retrained on realistic bearing error (gate G8)

**Requirements:** SRD Annex C §C.18 (owner decisions 2026-11-13); specs 012 (T2), 019 (realistic
error) and 020 (G8).

## Goal

Find out whether training on the error helps. Retrain T2's architecture from scratch on data with
realistic bearing error. The result must beat the frozen T2 on median range and pass G5 against the
frozen `-g1` IMM, on realistic-error test data.

## Functional requirements

- **FR-001 Training.**
  - Plan `configs/phase11/a`: dataset seed 226, 100,000 scenarios, phase-7 ranges, derived
    features.
  - Config `configs/phase11/a/tracker.json`: T2's config, id `lstm-gaussian-re`.
  - The job runs on GitHub Actions (`train/p11a`) under decision 39, and commits the model.
- **FR-002 Validation.**
  - The `tma-g5 --beat` diagnostic on seed 217 validation, with the frozen T2 as the estimator to
    beat, and the carry rule in §C.18.
  - Reported beside it: the clean twin, the rebuilt fused tracker and hybrid, and the baselines.
- **FR-003 Gate.** Decision 40 freezes both T2s by digest, plans and seed 227. G8 is scored on seed
  227 and judged by the agent panel.

## Out of scope

- Architecture or loss changes.
- Mixed clean and error training.
- Other error models.
