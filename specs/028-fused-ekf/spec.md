# Spec 028: the network's range fused into the EKF

**Requirements:** SRD Annex F; Annex E §E.6 (the IMM fusion's settled course); the go/no-go
report's condition 2.

## Goal

Test whether T2's range fused into a constant-velocity EKF beats both classical trackers re-tuned
to realistic bearing error, where the IMM fusion failed on course after a manoeuvre.

## Requirements

- **FR-001** `ekfRangeUpdate`: the log-range update of the EKF state, Joseph form, with the IMM
  fusion's measurement model.
- **FR-002** `fusedEkfPredict` and `fusedEkfName`: the EKF's rows with T2's range fused on the
  IMM fusion's schedule and guard; `ekfPredict` takes an optional per-sample hook for this.
- **FR-003** `tma-fuse-track --filter ekf --sigma-a <a>`; IMM flags refused with it, and
  `--sigma-a` refused without it.
- **FR-004** `parseFusedEkfName` round-trips the name; spec 015's re-computation binds it.
- **FR-005** The selection of Annex F §F.3, committed before any variant is scored.

## Tasks

- [x] T001 FR-001–FR-004 with tests; Annex F, the grid, `spec028-rows.mjs`,
      `spec028-fuse-grid.mjs`, `run.sh`, committed before any scoring
- [x] T002 Validation (`experiments/20261116-p15-val/`): grid, select; `validation.md`
- [x] T003 If carried: decision 43 (seed 233), plan, data from a clean tree
- [x] T004 If carried: G5 on seed 233, panel review, write-ups
- [x] T005 Algorithm note, go/no-go report, blog post, AGENTS.md

## Outcome

G5 passed on seed 233 against the re-tuned EKF (`experiments/20261116-p15-g5/`, panel
`review.md`; Annex F §F.6). Validation carried σa 0.07, k 4, M 3 (score 0.015).
