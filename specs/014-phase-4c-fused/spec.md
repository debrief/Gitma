# Spec 014: Phase 4c — the fused tracker

**Requirements:** SRD Annex C §C.11 (owner decision 31, 2026-11-02), §C.5 (G5), §C.6.

**Decision record:** `experiments/20261102-p4f-decision/` (decision 31).

## Goal

Judge, at G5 unchanged, the frozen reference IMM with the frozen T2's range fused in as a
measurement. This gives one track state, unlike phase 4b's hybrid.

## Functional requirements

- **FR-001 Fused tracker.** `immRangeUpdate` and `fusedPredict` (`@tma/classical`) and the CLI
  `tma-fuse-track` build the fused tracker's per-timestep predictions from a scenario file and T2's
  prediction file. The IMM's parameters, k and M are part of the estimator name. The header records
  T2's file digest (`inputs`).
- **FR-002 Settings.** k and M are chosen on seed-211 validation
  (`scripts/research/spec014-fused.mjs`) and frozen in the decision. The CLI must reproduce the
  research script's figures on validation.
- **FR-003 Fresh test.** Seed 214 (400,000; its test split generated alone), pinned in
  `configs/phase4/f/plan.json` and committed in the decision before it is scored.
- **FR-004 Gate.** `tma-g5 --decision --plan --model` on the seed-214 test split, with:
  - the IMM as reference;
  - T2's file passed with `--also`, so that the prediction chain binds the fused file to T2's
    weights;
  - the hybrid, the EKF and naive reported beside it.

  Then the agent panel and a write-up.
- **FR-005 Reported diagnostics.** On the test rows:
  - settled rows before and after any manoeuvre (`tma-g5` report);
  - NEES (`spec014-fused.mjs`);
  - bearing-rate consistency (`spec013-bearing-rate.mjs`).

## Out of scope

- Retraining T2.
- Re-tuning the IMM.
- Fusing T2's velocity.
- Any setting other than the frozen k and M.
