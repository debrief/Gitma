# Tasks: Iteration 4 — velocity outputs and derived features

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Setup PR (before any training)

- [x] T001 Research R1 (iteration-3 speed error by true speed; oracle de-bias), R2–R4
- [x] T002 Schema 0.10.0: `OutputParameterisation`; `TrainingConfig.output_parameterisation`,
  `velocity_scale_mps`
- [x] T003 `@tma/features` `output.ts` (encode, decode); loss, batches, prediction, `tma-g1`,
  `tma-g2` and the viewer read the parameterisation; tests (`packages/models/test/velocity.test.ts`)
- [x] T004 `tma-g2`: the other phase builds its own inputs when its feature set was not built
- [x] T005 `configs/iter4-*.json` (iteration 3's ranges), `configs/iter4/a` (iteration 3 + derived
  + velocity), plan with seed 205 digests pinned; seed 205 reserved
- [x] T006 SRD decision 23, Annex A D5; AGENTS.md; algorithm note (models: velocity loss and decoding)
- [x] T007 Decision record `experiments/20261022-i4-decision/` (change, forecast, validation rule,
  carried set, seed 205)

## Run

- [ ] T008 `train/i4a`: five models, chained jobs; validation diagnostic with the iteration-3 models
  beside
- [ ] T009 Validation rule (FR-006): carry to test or stop
- [ ] T010 G2 on the seed-205 test split with iteration 3 beside; agent panel; `review.md`;
  `decided_by`
- [ ] T011 Write-up: results page, blog post, AGENTS.md gate status; viewer catalogue adds the pair
