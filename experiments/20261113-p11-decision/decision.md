# Phase 11 decision: retrain T2 on realistic bearing error (decision 39)

This record is committed before training.

**Requirements:** SRD Annex C §C.18 and spec 023 (owner decisions 2026-11-13).

- **What is trained:** `lstm-gaussian-re`. It is T2's configuration (`configs/phase4/b/tracker.json`:
  2 × 128 LSTM, Gaussian velocity head, derived features, train seed 1202, the same losses and
  stopping rule), unchanged apart from its id. It is trained from scratch.
- **The data:** plan `configs/phase11/a`, dataset seed 226 (100,000 scenarios) with the phase-7
  ranges.
  - The digests are pinned in a commit after this one, before the training branch is pushed.
  - The normalisation comes from seed 226's train split, from inputs only.
  - Seed 226's test split is never scored.
- **Validation and carry rule:**
  - the `tma-g5 --beat` diagnostic on seed 217 validation (phase-7 ranges);
  - the candidate is `lstm-gaussian-re`, the estimator to beat is the frozen `lstm-gaussian`, and
    the reference is the `-g1` IMM;
  - it is carried if every one of the six point estimates is within its limit.
- **The gate:** decision 40, after validation and before the test data. It freezes both T2s by
  `model_digests`, with G8 on fresh seed 227 and a re-score on seed 228.
- **No forecast.** The frozen T2's robustness under this error is partly a property it may keep or
  lose when trained on the error.
