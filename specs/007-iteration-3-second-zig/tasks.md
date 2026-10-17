# Tasks: Iteration 3 — a second zig across the line of sight

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Setup PR (before any training)

- [x] T001 Research R1 (owner's ideas against the seed-203 gate data) and R2 (classical forecast)
- [x] T002 Schema 0.9.0: `ZigRule`, `los_offset_rad`, `zig2_delay_s` (ranges); `zig2_delay_s`,
  `zig2_angle_rad` (parameters); `zig2_index`, `turn2_start_index` (metadata)
- [x] T003 Generator 0.3.0: across-LOS rule and second zig; known-answer, generated-scenario and
  golden tests; 0.2.0 goldens unchanged; 0.1.0 and 0.2.0 data readable
- [x] T004 Viewer: second turn, leg 3, "zig 2" marker and readout
- [x] T005 Ranges `configs/iter3-ranges.json`, `configs/iter3-heldout-ranges.json`
- [ ] T006 SRD: Annex A §A.7 record, §3 rows, §8 decision 22; AGENTS.md
- [ ] T007 G0 on generator 0.3.0 (seed 42, noise-free, iteration-3 ranges) and its agent panel;
  the G0 guard test moves to it
- [ ] T008 Dataset seed 204 generated at a clean commit; plan `configs/iter3/a/plan.json` with
  digests; seed 204 reserved in `scripts/train-plan.mjs`; viewer catalogue shows the validation
  split
- [ ] T009 Decision record `experiments/<date>-i3-decision/` (change, forecast, validation rule,
  carried set, seed 204), committed before training

## Run

- [ ] T010 `train/i3a`: five models, chained jobs; validation diagnostic (`tma-g2 --split validation`)
- [ ] T011 Validation rule (FR-006): carry to test or stop
- [ ] T012 G2 on the seed-204 test split with 2c beside; agent panel; `review.md`; `decided_by`
- [ ] T013 Write-up: results page, blog post, AGENTS.md gate status; viewer catalogue adds the pair
