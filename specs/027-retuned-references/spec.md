# Spec 027: re-tuned references under realistic bearing error

**Requirements:** SRD Annex E; the go/no-go report's condition 2 (a stronger reference); spec 026.

## Goal

Judge the fused tracker against classical trackers tuned to the same realistic bearing error it
faces, with its own IMM re-tuned too.

## Tasks

- [ ] T001 Annex E, the grid, `spec027-tune.mjs`, `spec027-fuse-grid.mjs`, `run.sh`, committed
      before any scoring
- [ ] T002 Validation (`experiments/20261115-p14-val/`): tune, fuse, select; `validation.md`
- [ ] T003 If carried: decision 42 (seed 231), plan, data from a clean tree
- [ ] T004 If carried: G5 on seed 231, panel review, write-ups
- [ ] T005 Go/no-go report, blog post, AGENTS.md
