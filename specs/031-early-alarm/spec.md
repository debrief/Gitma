# Spec 031: the detector's early-alarm label

**Requirements:** SRD Annex I (owner decision I1); Annex H §H.6.

## Goal

Retrain spec 030's detector with a label that rewards an early onset alarm, and judge it as Annex H
judged the first.

## Requirements

- **FR-001** `detector_onset_rows` (schema 0.26.0) and `detectorOnsetLabel`: label 1 only in the
  first k rows after a course change begins; quiet rows 0; masked elsewhere. Absent: spec 030's
  label, unchanged.
- **FR-002** Training plan `configs/phase18/a` (seed 241, pinned digests), `det-onset` (k 12).
- **FR-003** `experiments/20261119-p18-val/run.sh`: Annex H §H.2's validation, reusing phase 17's
  hash-checked split and CUSUMs, committed before training.

## Tasks

- [x] T001 FR-001 with tests
- [x] T002 FR-002–FR-003, Annex I, committed before training; training on GitHub Actions
- [ ] T003 Validation (seed 217); `validation.md`
- [ ] T004 If carried: decision 46 (seed 242), G6 on test, panel review
- [ ] T005 Write-ups
