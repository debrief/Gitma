# Spec 022: Phase 10 — T2's range with the fused tracker's velocity (gate G8)

**Requirements:** SRD Annex C §C.17 (owner decisions 2026-11-12); specs 013 (tracker hybrid), 014
(fused tracker), 019 (realistic error) and 020 (G8).

## Goal

Under realistic bearing error, judge the hybrid of T2's range with the frozen fused tracker's
course and speed. It must pass G5 against the frozen `-g1` IMM, and beat the fused tracker on
median range. Nothing is trained or tuned.

## Functional requirements

- **FR-001 θ = 180°.** `tma-hybrid-track --course-deg` accepts (0, 180]. At 180 a converged
  tracker's velocity is always kept (tested).
- **FR-002 G8 binds the beaten file.** `tma-g5 --beat` re-computes the beaten file's sample too,
  for example the fused tracker from T2's file.
- **FR-003 Validation, decision and gate.**
  - **Validation:** the seed-217 diagnostic and the carry rule.
  - **Decision 38:** plan `configs/phase4/z`, seed 224, `beat_estimator` = the fused tracker.
  - **The gate:** G8 on seed 224, judged by the agent panel.

## Out of scope

- One coherent track state.
- Re-tuning θ, k or M.
- Retraining T2.
