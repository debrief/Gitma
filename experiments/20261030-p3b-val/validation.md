# Phase 3b on validation (spec 011 FR-002): stop

## Source

- **Training run.** 40939916080 (`train/p3b`, plan `configs/phase3/b`, commit c2e521b), after
  decision 27 (`../20261029-p3b-decision/`) was committed.
- **The carried model.** `lstm-two-hypothesis` (`../20261030-p3b-models/models/instantaneous`).
  It has the phase-3 configuration with a two-hypothesis output (`velocity_two_hypothesis`) and
  `loss_weight_manoeuvre` 1, trained from scratch on seed 208. Training stopped early after 53
  epochs (two chained jobs, 9.0 h); the best validation loss was 0.708.
- **Data.** Seed 208's validation split (10,000 scenarios).
  - It was regenerated at c2e521b by `train-plan.mjs data`, with the plan's digests checked.
  - Its content digest (39167c17…) is the one phase 3 used. Only the provenance header differs.
- **Reference.** The frozen `imm-cv0.003-ct0.1-w0.001-s0.001-r2`, re-run on the same file. Its
  rows are identical to phase 3's.
- **Command.** `tma-g4` with no decision (`diagnostic.json`, `report.json`). Detection figures
  are in `detection.json` (`scripts/research/spec011-detection.mjs`).
- **Comparisons on the same rows.**
  - Phase 3a's network, naive and batch least squares are taken from
    `../20261029-p3a-val/report.json` and `baselines.json`.
  - Those files have the same content digest and the same row selection.
- **Statistics.** σ = 1°; 95% bootstrap intervals, 2,000 resamples, seed 20261011.

**The test split (seed 210) has not been scored.** It stays reserved and unseen.

## Validation rule: stop

| Condition (decision 27) | Required | Result | |
| --- | --- | --- | --- |
| G4-range: network / reference, manoeuvre + 300 s | point < 1, interval not wholly ≥ 1 | 0.760 [0.720, 0.798] | holds |
| G4-course | point < 1, interval not wholly ≥ 1 | 0.601 [0.566, 0.642] | holds |
| G4-control range, held course, zig + 300 s | < 20% | 7.06% [6.50, 7.74] | pass |
| G4-control course, held course, zig + 300 s | < 10° | 6.10° [5.52, 6.94] | pass |
| G4-control speed, held course, zig + 600 s | < 1 kt | **1.15 kt [1.05, 1.25]** | **fail** |
| Reported: G4-speed | | 0.671 [0.631, 0.711] | |
| Reported: G4-gross (network − reference) | | −6.43 pp [−7.29, −5.55] | |

The speed control fails, with its whole interval above the limit, so the model does not go to
the test split.
- **The rule.** FR-002 and Annex B §B.8.
- **Annex B §B.5's second branch applies.** Publish the result; the owner decides separately on
  an end-to-end learned tracker.
- **This was the last attempt.** Annex B §B.8 says so: a further design is a new decision.

## The numbers (σ = 1°, medians)

| Estimator | Turning, manoeuvre + 300 s: range | course | speed | Held, zig + 300 s: range | course | Held, zig + 600 s: speed |
| --- | --- | --- | --- | --- | --- | --- |
| **Phase 3b network** (two hypotheses) | **10.3%** | **14.5°** | **1.57 kt** | 7.06% | 6.1° | 1.15 kt |
| Phase 3a network (one estimate) | 10.5% | 14.4° | 1.57 kt | 7.56% | 11.1° | 1.60 kt |
| IMM, reference | 13.6% | 24.1° | 2.34 kt | 5.21% | 5.0° | 0.71 kt |
| EKF (tuned-turn) | 15.3% | 24.4° | 3.04 kt | 7.74% | 6.5° | 1.82 kt |
| Batch least squares (per timestep) | 29.7% | 64.6° | 3.26 kt | 3.00% | 1.2° | 0.31 kt |
| Naive | 41.0% | 89.1° | 4.29 kt | 40.5% | 85.7° | 4.20 kt |

- **Rows.** n = 4,074 turning rows. Held course: 1,042 rows at zig + 300 s and 913 at zig + 600 s.
- **P90s, after the turn.** Range is 27.1% (3a 30.4%, IMM 45.3%) and course 55.0° (3a 57.6°,
  IMM 92.5°).
- **P90s, held course.** Course P90 is 51.1°, worse than 3a's 34.1° and the IMM's 30.0°. Speed
  P90 is 3.70 kt (3a 4.80, IMM 4.03).

**After the turn, by turn timing (median range error).**

| Slice | n | Phase 3b | Phase 3a | IMM |
| --- | --- | --- | --- | --- |
| Turn before ownship's second zig | 1,533 | 10.3% | 10.7% | 12.5% |
| Turn overlaps the second zig | 1,398 | 9.7% | 10.2% | 14.4% |
| Second zig before the turn | 1,143 | 10.9% | 10.8% | 14.1% |

## The turn flag (FR-004)

P(turned) is the network's own output. Here, "alarm" means p > 0.5.

| Measure | Value |
| --- | --- |
| Turning scenarios: detection delay from the turn's first sample, median [P10, P90] | 70 s [0, 140] |
| Turning scenarios: never detected by manoeuvre + 300 s | 0.5% |
| Turning scenarios: alarm before the turn starts | 24.7% |
| Held course: alarm at zig + 300 s | 30.5% |
| Held course: alarm at zig + 600 s | 28.6% |
| Held course: alarm on some row | 72.2% |
| AUC of P(turned) at zig + 300 s, against the truth label | 0.79 (2,757 turned, 2,359 not yet / never) |

**Held course, speed at zig + 600 s, split by the hypothesis reported:**

| Reported | n | Median abs. error | Median signed error | Slow |
| --- | --- | --- | --- | --- |
| Held | 652 | 1.00 kt | −0.06 kt | 52% |
| Turned (a false alarm) | 261 | 1.80 kt | −1.65 kt | 78% |
| All | 913 | 1.15 kt | −0.33 kt | 59% |
| IMM, all | 913 | 0.71 kt | +0.24 kt | 35% |

**Held course, median course error over time:**

| Time after zig | 2 min | 5 min | 10 min | 15 min |
| --- | --- | --- | --- | --- |
| Phase 3b | 5.5° | 6.1° | 5.5° | 4.6° |
| Phase 3a | 6.0° | 11.1° | 11.5° | 11.1° |
| IMM | 6.0° | 5.0° | 3.7° | 4.5° |

## Against the forecast (decision 27, recorded before training)

| Quantity | Forecast | Result |
| --- | --- | --- |
| Held-course course error | about 6° | 6.1°, as forecast |
| Held-course speed error | about 0.95 kt (0.8–1.2) | 1.15 kt: inside the band, above the limit |
| G4-range | about 0.85 | 0.76, better |
| G4-course | about 0.7 | 0.60, better |
| P(carried to test) | about 40% | not carried |

## What happened

The two-hypothesis output did what it was designed to do:
- **No more averaging of course.** Held-course course error fell from 11.1° to 6.1°, and it no
  longer grows with time.
- **The post-turn advantage is unchanged.** It is in fact slightly larger (range 0.76, gross
  −6.4 pp).

It did not fix speed. Two things combine:
1. **The turn flag false-alarms on held course.**
   - About 29–31% of held-course rows at zig + 5 and 10 min report "turned", and 72% of held
     scenarios raise an alarm at some row.
   - The turned hypothesis is biased slow (−1.65 kt), so every false alarm costs about 1.8 kt.
   - In this data a turn usually starts 2–8 min after the zig (R1), and bearings cannot tell a
     slow early turn from noise for a while. P(turned) is therefore near 0.5 there. The AUC of 0.79
     may be close to what bearings allow, but that was not measured: no detector baseline (for
     example a CUSUM on the IMM's innovations) was run.
2. **The held hypothesis is only at the limit.** Where the network reports "held", the error is
   1.00 kt with almost no bias.
   - This is a selected subset: the rows the flag found easiest to call held.
   - So even a perfect flag would leave this design at or just above 1 kt.
   - The comparison: the IMM reaches 0.71 kt on all rows and batch least squares 0.31 kt.

## Reading it critically

- **The gate is not close.** The interval [1.05, 1.25] is wholly above 1 kt. A larger
  validation set would not change the outcome, and the test split cannot rescue a model the rule
  holds back.
- **Hard switching has a cost the medians hide.** Held-course course P90 rose from 34° to 51°:
  a false alarm reports the wrong hypothesis outright, not a blend. An averaged output and a
  switched output fail in different places, and this test chose median error, where switching
  wins on course and loses on speed.
- **The design has been through the gate once.** No tuning of the threshold (0.5) or of
  `loss_weight_manoeuvre` was done on validation, because that would make this split a training
  signal. A threshold above 0.5 would cut false alarms but delay detection. It would also be a
  new pre-registered design, and Annex B §B.8 closes phase 3 to further attempts.
- **What stands.**
  - **After a turn**, two different network outputs beat a tuned IMM by about a quarter on range
    and 40% on course. This is consistent across turn timing.
  - **On held course**, neither network output stays within G2's limits, and both are 1.6–2.3 ×
    the IMM on speed.
  - **Overall**, the network trades held-course accuracy for turn accuracy. It does not
    dominate the tracker, which is the claim G4 required.
- **Two levers changed together.** The output form and its supervision changed at once, as
  declared in spec 011. This result cannot say which one moved course and which one failed to
  move speed.
