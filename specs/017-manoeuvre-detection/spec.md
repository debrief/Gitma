# Spec 017: Phase 5 — manoeuvre detection (gate G6)

**Requirements:** SRD Annex C §C.6 item 1 and §C.12 (owner decisions 2026-11-05); decision 32
(the reference is the `-g1` IMM).

## Goal

Judge whether a manoeuvre detector built from frozen models, with no training, detects target
course changes faster than a CUSUM on the reference IMM's innovations, at the same false-alarm
rate.

## Functional requirements

- **FR-001 Detection files** (schema 0.19.0: `DetectionHeader`, `Detection`, `DetectionRow`).
  These are per-timestep scores, with the inputs' SHA-256s in the header. `tma-detect` writes
  them as a pipeline stage of its own.
- **FR-002 CUSUM** (`cusumDetect`, `@tma/classical`) on the IMM's innovations. The kind is `nis`
  (variance) or `mean` (two-sided, signed ν/√S). The drift c and clip are in the name
  `cusum-<kind>-<imm>-c<c>-x<clip>`. The IMM now reports `innovation` on its state; its rows are
  unchanged (golden).
- **FR-003 Learned candidates** from frozen predictions:
  - `disagree-<network>-<tracker>`: |Δcourse| between T2 and the IMM;
  - `crate-<network>-w<w>`: T2's course change over w samples.
- **FR-004 Scoring** (`gate-g6.ts`):
  - events, the armed rule, delays, and false alarms on quiet rows;
  - threshold calibration to 0.5 false alarms per hour;
  - the three G6 checks (§C.12).
- **FR-005 `tma-g6`.**
  - **Validation:** calibrates every candidate, carries the best of each kind (smallest median
    delay), and writes `calibration.json` and `diagnostic.json`.
  - **Test (the gate):**
    - the decision binds the seed, plans, detectors, thresholds (`detector_thresholds`, schema
      0.19.0) and frozen models;
    - the data postdate the decision;
    - the input chain is checked;
    - a 200-scenario sample is re-computed from names and inputs;
    - the decision and seed are scored once;
    - it writes `verdict.json` and `scoring.json`.
- **FR-006 Research and decision.** On seed-211 validation:
  - the CUSUM grid: `nis` with c ∈ {0.5, 0.75, 1, 1.25} and clip ∈ {2, 5}; `mean` with
    c ∈ {0.25, 0.5, 0.75, 1} and clip 3;
  - the two learned candidates.

  Decision 33 freezes the carried pair, their thresholds, T2's digests and fresh seed 215, before
  any test data exist.

## Out of scope

- Training anything.
- Speed-change detection as a gated claim (it is reported).
- Changing the reference IMM.
