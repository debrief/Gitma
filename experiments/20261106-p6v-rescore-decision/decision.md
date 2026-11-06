# Phase 6 re-score decision: G7 on seed 216 (decision 34)

This record is committed before seed 216's test data are generated for scoring. Seed 216's split
was generated once, to pin its content digest in `configs/phase4/v/plan.json`, and then deleted
unscored.

**Owner decision (2026-11-06):** re-score G7, keeping the rules as written, with a split of at
least 110,000 scenarios.

## What is re-scored

- **The same estimators and settings as decision 33**, unchanged:
  - tracker: `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd-k4-m6`;
  - reference: `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd`;
  - T2 by `model_digests`;
  - the six frozen multipliers per tracker.

  `tma-g7` refuses a re-score that changes any of these (`requireG7Rescore`).
- **The same rules (§C.13).** Six coverage checks within nominal ± 2 pp, three width checks wholly
  below 1, 95% scenario-clustered intervals.
- **The test.** Fresh seed 216: 1,100,000 scenarios, of which the 110,000-scenario test split is
  generated alone, at a clean commit descending from this one. The panel sized it so that a
  ±0.3 pp coverage interval is reachable.
- **This is final.** It is the one re-score §C.13 and C.5 allow; a fail or an inconclusive result
  is final.

## Changed since decision 33 (no effect on results)

`tma-g7` now streams the truth into compact rows. On seed 215 it reproduces all 15 checks of the
committed verdict exactly, and its peak memory fell from about 5 GB to about 0.4 GB.

## Forecast, recorded before scoring

- **Log-range 50% coverage** is expected near 48.3% again, with a half-width of about 0.3 pp.
- **P(pass) is about 50%.** A fail needs a point estimate below about 47.7%, which is unlikely.
- **The other eight checks** are expected to pass, as on seed 215.
- **How a pass would be read.** The pooled coverage reaches the floor. It would not show that the
  tracker is well calibrated: conditional coverage is expected to stay poor (seed 215:
  log-range 50% at 67% before any manoeuvre and 38% after one), and it will be reported.

## Known limits

Those of decision 33 and of the G7 panel (`experiments/20261106-p6u-g7/review.md`):
- coverage is marginal only;
- many course intervals are vacuous;
- the shortfall is systematic;
- the agent wrote the rules, and the owner kept them.
