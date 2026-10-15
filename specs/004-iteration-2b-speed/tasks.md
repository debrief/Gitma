# Tasks: Iteration 2b — speed-weighted loss

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

## Setup PR

- [x] T001 [US1] `train.ts`: on a resume with an optimizer restart, re-score `best/` under the current loss (FR-002); test in `train-continue.test.ts`
- [x] T002 [US2] `train-plan.mjs`: `dataset.fresh_test {seed, digest}`, validated (FR-003, FR-004), used by `data` and `check-digests`; tests in `train-plan.test.ts`
- [x] T003 [US3] `tma-g2 --plan` (content digests, recorded in the manifest), decision ancestry, `requireSameRows`; `evaluate-args` passes `--plan` on test; tests in `g2.test.ts`
- [x] T004 [US1] `configs/iter2/c/*.json` (`loss_weight_speed` 4, `max_epochs` 220) and `plan.json` (fresh test seed 202, pinned digest)
- [x] T005 [US4] Decision record `experiments/20261014-i2c-decision/decision.{json,md}` (carried set: the 2b models, unconditionally)
- [x] T006 Spec 003 research R19 follow-ups marked done; AGENTS.md commands (`--plan`) and the iteration-2b status

## Run

- [x] T007 [US1] Push `train/i2c`; collect `results/i2c-<run>`; commit `experiments/<date>-i2c-val` (validation diagnostic)
- [x] T008 [US4] G2 on the fresh test split at a clean main commit → `experiments/<date>-i2c-g2` (phase B beside it as the other phase)
- [ ] T009 [US4] Agent review panel; fix or answer findings; `review.md`; `decided_by`
- [ ] T010 [US4] Site: `results/iteration-2b.mdx`, blog post, glossary as needed; AGENTS.md gate status
