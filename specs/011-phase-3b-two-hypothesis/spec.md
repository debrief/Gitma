# Spec 011: Phase 3b — a two-hypothesis output

**SRD trace:** Annex B §B.4–B.5 and §B.8 (added by this spec); Annex A Part B rules (one lever,
decision record before training, fresh test seed).
**Owner decisions, 2026-10-29:**
- after phase 3 stopped at validation, try a two-hypothesis output;
- supervise its turn flag from the generator's truth.

## Why

Phase 3's network beat the tuned IMM after a turn on validation (range 0.77, course 0.60) but
failed G4-control on held course (course 11.1°, speed 1.60 kt).

- **Why it failed.** It hedged: trained with squared error, it reported the conditional mean
  over "turned" and "not turned". An averaged velocity is shorter, and its direction is pulled
  (`experiments/20261029-p3a-val/validation.md`).
- **What this tests.** Whether removing the averaging keeps the post-turn advantage without the
  held-course cost.

## The change (one lever)

Output parameterisation `velocity_two_hypothesis` (schema 0.14.0):

- **Outputs.** Seven channels per row:
  - hypothesis 0, the target has not turned: log range, vx, vy;
  - hypothesis 1, the target has turned: log range, vx, vy;
  - a logit of P(turn started by this row).
- **Label.** `turnedLabel`: 1 from the first row whose stored truth course differs from row 0's.
  A held-course target's stored course is bit-identical on every row. The label is a training
  target only: no input changes and normalisation is untouched, so there is no leakage.
- **Loss.** Each hypothesis's weighted squared error counts only on rows where it is true. The
  logit adds `loss_weight_manoeuvre` (1) × binary cross-entropy.
- **Reported estimate.** The hypothesis with P > 0.5, never a mixture. The prediction row also
  carries `p_manoeuvre`.
- **Everything else is phase 3a's:**
  - iteration-4 LSTM configuration, from scratch;
  - the same seed-208 train and validation data;
  - the same frozen reference (`imm-cv0.003-ct0.1-w0.001-s0.001-r2`);
  - the same G4 checks and validation rule.

## Requirements

- **FR-001:** the parameterisation, label, loss and decoding as above, with unit tests:
  - the label from the truth course, against the generator's turn indices;
  - decoding the more probable hypothesis;
  - the masked loss;
  - the 7-channel head;
  - training and prediction end to end.
- **FR-002 (validation rule, as spec 010 FR-007).** On seed 208's validation split, against the
  frozen reference, carry to test only if all of these hold:
  - G4-range and G4-course: point below 1, interval not wholly at or above 1;
  - G4-control: all three checks pass.

  Otherwise phase 3b stops at validation.
- **FR-003 (G4).** As spec 010 FR-008 and FR-009, on fresh seed 210:
  - a 400,000-scenario dataset, of which its 40,000-scenario test split is scored;
  - the decision record names the plan `configs/phase3/b`, the carried model
    `lstm-two-hypothesis` and the same reference.
- **FR-004 (reporting).** As spec 010 FR-010, plus:
  - the turn flag's detection performance: P(turned) against the truth label, its false-alarm
    rate on held-course rows, and its delay after the turn starts;
  - phase 3a's network on the same validation rows.

## Success criteria

- **SC-001:** decision record 27 is committed before training.
- **SC-002:** one validation look, then at most one test scoring and one re-score (SRD §7).
- **SC-003:** the write-up states the outcome against Annex B §B.5.

## Risks

- **The flag may be slow.** Turns show in the bearings a median 130 s after they end (spec 010
  R1). Until P crosses 0.5 the network reports the held hypothesis, so after a turn it could lag
  as the tracker does. G4-range and G4-course measure this.
- **The flag may be too eager on held course.** A false alarm reports a turned estimate for a
  target that holds course. The control checks measure this, and FR-004 reports it.
- **A hard switch can jump.** Estimates can jump at the switch. Smoothness is not gated; the
  viewer shows it.
- **Two levers are entangled.** The output and the supervision change together. This is
  declared: the owner chose both at once.
