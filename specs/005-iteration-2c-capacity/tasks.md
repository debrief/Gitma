# Tasks: Iteration 2c — capacity and loss together

**Spec**: [spec.md](spec.md) · **Decision**: `experiments/20261015-i2d-decision/`

## Setup PR

- [x] T001 SRD §7 amendment (2c allowed, then stop; hyperparameter cap stands)
- [x] T002 `configs/iter2/d/*.json` (2 × 128 for the recurrent models and the shuffled control, speed weight 4, 150 epochs) and `plan.json` (fresh test seed 203, pinned digest)
- [x] T003 Decision record `experiments/20261015-i2d-decision/decision.{json,md}`
- [x] T004 Spec 005; AGENTS.md gate status

## Run

- [x] T005 Push `train/i2d`; chained jobs and re-pushes until every model completes; commit `experiments/<date>-i2d-val`
- [ ] T006 G2 on the seed-203 split at a clean commit → `experiments/<date>-i2d-g2` (2b beside as other phase)
- [ ] T007 Agent review panel; `review.md`; `decided_by`
- [ ] T008 Site: results page, blog post; AGENTS.md; if G2 fails, the no-go write-up
