# Spec 030: a trained manoeuvre detector

**Requirements:** SRD Annex H (owner decisions H1–H2); Annex C §C.12 and phase 5's lessons;
Annexes D and G (the detection weakness).

## Goal

Train a detector network for target course changes under realistic bearing error and judge it
against the best re-tuned CUSUM at G6 under revised rules.

## Requirements

- **FR-001** `manoeuvre_detector` output parameterisation: one logit; `detectorLabel` from the
  stored targets; masked BCE (`detectorLossParts`); decoded to `p_manoeuvre` (schema 0.25.0).
- **FR-002** `modelDetect` / `pman-<network>`; `tma-detect --detector model`; `tma-g6`
  re-computes it from its bound prediction file.
- **FR-003** G6 rules `h` (`--rules h`, decision `g6_rules`): detect5 superiority, delay on
  events both detect, false alarms as before; refused when rules and decision disagree.
- **FR-004** Training plan `configs/phase17/a` (seed 238, pinned digests); Annex H's validation
  protocol in `experiments/20261118-p17-val/run.sh`, committed before training.

## Tasks

- [x] T001 FR-001–FR-003 with tests; end-to-end smoke (train, predict, detect)
- [x] T002 FR-004: Annex H, plan, config, run.sh committed; training on GitHub Actions
- [x] T003 Validation (seed 217): calibrate, select the CUSUM, G6 diagnostic; `validation.md`
- [x] T004 (not carried: skipped) If carried: decision 45 (seed 239), G6 on test, panel review
- [x] T005 Write-ups: algorithm note, go/no-go report, blog, AGENTS.md

## Outcome

Stopped at validation: detect5 −1.08 pp [−2.05, −0.15] and joint delay 1.46 × against the best
re-tuned CUSUM. See `experiments/20261118-p17-val/validation.md` and Annex H §H.6.
