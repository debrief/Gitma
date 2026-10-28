# Tasks: Iteration 5 — hybrid estimator (G3)

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Setup PR (before any seed-207 data)

- [x] T001 Research R1 (per-leg fit), R2 (network-initialised solver), R3 (switch, validation
  diagnostic)
- [x] T002 `@tma/classical` `hybridSwitch`, `useNetwork`, `SWITCH_RANGE_REL`; tests
- [x] T003 `@tma/eval` `bootstrapQuantileRatio`, `bootstrapRateDifference`, `gate-g3.ts`
  (`g3Checks`, `g3Verdict`); tests
- [x] T004 CLIs `tma-hybrid` and `tma-g3`: the decision is required on a test split, and
  `diagnostic.json` is written on any other
- [x] T005 SRD decision 24, Annex A D6; AGENTS.md; algorithm note (hybrid); glossary
- [x] T006 Decision record `experiments/20261027-i5-decision/` (rule, forecast, seed 207, LSTM
  digests)

## Run

- [x] T007 Generate seed 207's test split (20,000), record its digest; features; LSTM, classical
  and naive predictions; hybrid; `tma-eval`
- [x] T008 `tma-g3 --decision` into `experiments/<date>-i5-g3`; agent panel; `review.md`;
  `decided_by`
- [x] T009 Write-up: results page, blog post, AGENTS.md gate status
