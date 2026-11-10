# Spec 020: Phase 8 — the fusion re-tuned for correlated error (gate G8)

**Requirements:** SRD Annex C §C.15 (owner decisions 2026-11-10); decisions 31, 32 and 35.

## Goal

Under realistic bearing error, find a fusion weighting (k, M) on validation under which the fused
tracker beats T2 alone on range while still passing G5 against the `-g1` IMM, and judge it on a
fresh test seed. Nothing is trained.

## Functional requirements

- **FR-001 Research grid** (`scripts/research/spec020-grid.mjs`): 24 (k, M) variants on seed 217
  validation with the phase-7 ranges. The six point ratios and the score are computed as §C.15
  defines them, and the selection rule is applied mechanically (`grid.json`, `research.md`).
- **FR-002 G8 scoring** (`tma-g5 --beat <network.ndjson>`). It adds the gated check
  `g8-range-vs-network`: tracker/network median range error over all G5 rows, at 97.5% with a
  scenario-clustered bootstrap, wholly below 1.
  - The verdict's gate is then **G8**.
  - On a test split the decision must name the beaten estimator (schema 0.22.0
    `ChangeDecision.beat_estimator`), and its file must be in the bound prediction chain.
  - Scored once per decision and seed, as G5.
- **FR-003 Decision and gate.** Decision 36 freezes the carried name, plan `configs/phase4/x`
  (fresh seed 220) and `beat_estimator`. G8 is then scored and judged by the agent panel.

## Out of scope

- Re-training T2, re-tuning the IMM's noise settings, and bias-state filters.
- Other error models.
