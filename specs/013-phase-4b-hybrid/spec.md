# Spec 013: Phase 4b — the tracker hybrid

**Requirements:** SRD Annex C §C.10 (owner decision 30, 2026-11-01), §C.5 (G5), §C.6.
**Decision record:** `experiments/20261101-p4h-decision/` (decision 30).

## Goal

Judge, at G5 unchanged, a hybrid of the frozen IMM reference and the frozen recurrent tracker T2.
The hybrid reports T2's range always and T2's velocity only where the two estimators' courses
disagree by more than θ.

## Functional requirements

- **FR-001 Hybrid.** `trackerHybrid` (`@tma/classical`) and the CLI `tma-hybrid-track` build the
  hybrid's per-timestep predictions from the two estimators' prediction files. The threshold is
  part of the estimator name.
- **FR-002 Rule choice.** θ is chosen on seed-211 validation by the declared criterion in Annex C
  §C.10 (`scripts/research/spec013-hybrid.mjs`), and frozen in the decision.
- **FR-003 Frozen binding.** `tma-g5` accepts a decision with `model_digests`: the `--model`
  directories must be exactly those models, file for file, in place of training ancestry.
- **FR-004 Fresh test.** Seed 213 (400,000; its test split generated alone), pinned in
  `configs/phase4/h/plan.json` and committed in the decision before it is scored.
- **FR-005 Gate.** `tma-g5 --decision --plan --model` on the seed-213 test split, with the IMM as
  reference and T2, the EKF and naive reported beside it; agent panel; write-up.

## Out of scope

Retraining either estimator; tuning the IMM; any rule family other than the one declared.
