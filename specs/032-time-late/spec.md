# Spec 032: a time-late network against classical smoothers

**Requirements:** SRD Annex J (owner decisions J1–J2); SRD §1 (the time-late consumer); iterations
1–4's time-late models.

## Requirements

- **FR-001** `ekfSmooth` (RTS) and `immSmooth` (per-model RTS through the IMM's recorded mixing,
  Kim's probabilities); `tma-track --filter ekf-smooth | imm-smooth`; names `ekfs-` / `imms-`,
  re-computed by the gates.
- **FR-002** Smoother tuning (`spec032-tune.mjs`, `configs/phase19/smoother-grid.json`).
- **FR-003** Training plan `configs/phase19/a` (seed 244, pinned digests; `t2-tl`, time_late).
- **FR-004** Selection (`spec032-select.mjs`) and validation (`experiments/20261120-p19-val/`),
  committed before training and tuning.

## Tasks

- [x] T001 FR-001 with tests
- [x] T002 FR-002–FR-004, Annex J, committed before training and tuning
- [ ] T003 Tuning and training; validation; `validation.md`
- [ ] T004 If carried: decision 47 (seed 245), the gate, panel review
- [ ] T005 Write-ups: algorithm note, go/no-go report, blog, AGENTS.md
