# Spec 027: re-tuned references under realistic bearing error

**Requirements:** SRD Annex E; the go/no-go report's condition 2 (a stronger reference); spec 026.

## Goal

Judge the fused tracker against classical trackers tuned to the same realistic bearing error it
faces, with its own IMM re-tuned too.

## Tasks

- [x] T001 Annex E, the grid, `spec027-tune.mjs`, `spec027-fuse-grid.mjs`, `run.sh`, committed
      before any scoring
- [x] T002 Validation (`experiments/20261115-p14-val/`): tune, fuse, select; `validation.md`
- [x] T003 (not carried: skipped) If carried: decision 42 (seed 231), plan, data from a clean tree
- [x] T004 (not carried: skipped) If carried: G5 on seed 231, panel review, write-ups
- [x] T005 Go/no-go report, blog post, AGENTS.md

## Outcome

Stopped at validation: best score −0.173 (k 4, M 12), binding on settled course against the
re-tuned EKF (1.29 ×). See `experiments/20261115-p14-val/validation.md` and Annex E §E.6.
