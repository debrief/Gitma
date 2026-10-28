# Phase 3 decision: G4, the network against the tuned tracker after a turn (decision 26)

The decision is committed before the carried model is trained and before any seed-209 data
exist. Spec: `specs/010-phase-3-manoeuvre/` (FR-007 to FR-011). Annex: `docs/SRD-annex-B.md`
§B.3–B.5.

## The carried network (Annex B D5)

- **Model.** `lstm-instantaneous`, configured as iteration 4's LSTM
  (`configs/phase3/a/instantaneous.json`, identical to `configs/iter4/a/instantaneous.json`):
  - 2 × 128 stacked LSTM layers, causal;
  - velocity outputs, derived features, `loss_weight_speed` 4;
  - train seed 1001, max 150 epochs, patience 6.
- **Training.** From scratch on generator 0.4.0 data (plan `configs/phase3/a/plan.json`):
  - dataset seed 208, 100,000 scenarios: train 80,000, validation 10,000;
  - one target course change in 80% of scenarios.
- **No other model is trained.** The hybrid of spec 009 (this LSTM with batch least squares) is
  reported, never gated.
- **No architecture change.** The phase tests whether this design, shown turns in training,
  beats the tracker. Changing the design too would leave the result unattributable.

## The frozen reference (Annex B §B.3, owner decision 2026-10-28)

The reference is the better of the tuned-turn IMM and the tuned-turn EKF on the seed-208
validation split, by median range error at manoeuvre + 300 s (σ = 1°):

| Tracker | Setting | Estimator name | Median | P90 |
| --- | --- | --- | --- | --- |
| **IMM (reference)** | σ_cv 0.003, σ_ct 0.1, σ_ω 0.001, switch 0.001/s, P0 × 1, R × 2 | `imm-cv0.003-ct0.1-w0.001-s0.001-r2` | **13.6%** | 45.2% |
| EKF (reported) | σ_a 0.1, P0 × 4, R × 4 | `ekf-sa0.1-p4-r4` | 15.3% | 47.3% |

Also reported:

| Tracker | Estimator name | Median |
| --- | --- | --- |
| Tuned-straight IMM | `imm-cv0-ct0.03-w0.01-s0.00001-p4-r4` | 3.23% on held course at zig + 300 s |
| Tuned-straight EKF | `ekf-sa0.001-p4-r4` | 3.28% |

- **Grids.** `configs/phase3/tracker-grid.json` and `tracker-grid-ext.json` (research R2,
  `experiments/20261028-p3-research/`).
- **The extension.** It was added because the first pass's best IMM sat on the grid's edge. The
  optimum is flat: the best ten settings span 13.6–14.0%.
- **Frozen.** Every parameter is in the estimator name. `tma-g4` refuses reference predictions
  under any other name.

## Validation rule (FR-007), before any test scoring

The trained model is scored on seed 208's validation split against the frozen reference. The
command is `tma-g4` with no decision, which writes `diagnostic.json`. It is carried to test only
if **all** of these hold:
- G4-range and G4-course: point estimate below 1, and interval not wholly at or above 1;
- G4-control: all three checks pass.

Otherwise phase 3 stops at validation and is written up under Annex B §B.5's second branch.

## What decides (G4, Annex B §B.4)

`tma-g4 --decision experiments/20261028-p3-decision/decision.json --plan configs/phase3/a/plan.json
--model <the trained model>` on the test split of **fresh seed 209**:
- 400,000-scenario dataset, so 40,000 test scenarios, indices 360,000–399,999;
- generated alone, `train-plan.mjs data … test`;
- content digest pinned in the plan.

Turning rows are judged at manoeuvre + 300 s, on the σ = 1° slice, with paired bootstrap 95%
intervals (2,000 resamples, seed 20261011):

| Check | Statistic | Limit |
| --- | --- | --- |
| G4-range | median range error, network / reference | wholly below 1 |
| G4-course | median course error, network / reference | wholly below 1 |
| G4-speed | median speed error, network / reference | reported, not gated |
| G4-gross | gross-error rate, network − reference | wholly at or below 0 |
| G4-control | network on held-course rows: range < 20% and course < 10° at zig + 300 s, speed < 1 kt at zig + 600 s | all pass |

- **Pass:** range, course, gross and the three control checks all pass.
- **Fail:** any of them fails.
- **Inconclusive:** anything else. One re-score on a larger fresh seed is allowed (SRD §7), then
  it fails.

**Declared in advance (FR-011):**
- **Rows scored.** Only rows at or after `manoeuvre_index` + 30 samples (unit-tested).
- **Non-converged rows.** For either estimator they count as infinite error and as gross errors.
  The reference has more of them (0.9% of validation gate rows against the EKF's 0.2%), which
  slightly favours the network on G4-gross. This is disclosed, not corrected.
- **Control baseline.** G2's absolute thresholds on phase-3 held-course rows. On seed 208's
  validation split the untrained iteration-4 LSTM passes them (6.4%, 4.7°, 0.87 kt).
- **Test size.** About 16,000 turning σ = 1° rows. About 3,500 held-course σ = 1° rows reach
  zig + 600 s, so the speed control's interval is about ±0.04 kt.
- **Reported beside it (FR-010),** on the same rows:
  - estimators: naive, per-timestep batch least squares, both tunings of both trackers, and the
    hybrid;
  - the timing slice: the turn before ownship's second zig, overlapping it, or after it (no
    ownship manoeuvre after the turn);
  - turn-angle and range bands;
  - error curves against time since the manoeuvre.
- **Post-turn sanity check under noise** (red team), on validation. Where ownship zigs after the
  turn, the reference's median range error at manoeuvre + 300 s is 12.5%, against 31.5% for a
  batch fit on post-turn bearings alone (n 1,533). The reference uses the pre-turn track, as it
  should.

## Forecast (R4), recorded before training

The floor, from R3 on validation: the iteration-4 LSTM, never shown a turn, scores against the
frozen reference:

| Check | Ratio or difference | 95% CI | Result |
| --- | --- | --- | --- |
| Range | 1.92 | [1.83, 2.03] | fail |
| Course | 2.21 | [2.11, 2.33] | fail |
| Gross | +10.3 pp (18.9% against 8.5%) | | fail |
| Control | | | pass |

Its errors after the turn are 26.1% in range and 53° in course. The reference's are 13.6% and
24.1°.

What the retrained network must do:
- halve its post-turn range error;
- cut its course error by more than half;
- keep its held-course figures.

What favours the network:
- it can learn three priors the tracker lacks: speed is constant through the turn, turn timing
  falls 2–8 min after the zig, and turns are 30–120°;
- the reference is still settling five minutes after the turn (24° median course error);
- 20% of turns are not yet visible in the bearings at the gate point (R1).

What counts against it:
- on held course every network in this project has been about 2 × batch least squares;
- the reference's straight-leg error at this noise is near the batch solver's (R2).

**Forecast.**

| Quantity | Central | Plausible range |
| --- | --- | --- |
| G4-range ratio | 1.0 | 0.75–1.3 |
| G4-course ratio | 0.85 | 0.6–1.2 |
| G4-gross difference | about 0 | |

P(G4 passes) ≈ 30%. The most likely single outcome is a course pass with range inconclusive or
failing. Annex B §B.5 fixes what follows either way.
