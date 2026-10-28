# Feature Specification: Phase 3 — Manoeuvring Targets and Gate G4

**Feature Branch**: `010-phase-3-manoeuvre`

**Created**: 2026-10-28

**Status**: Planned. Decision 25 (SRD Annex B D1–D4), 2026-10-28. No code until this spec and
its decision record are committed.

**Input**: All four gates of the SRD main body are passed; G3 by a hybrid, not a network alone
(spec 009). Every gate assumed a constant-velocity target, which is the classical estimator's own
assumption. The owner set the next bar: **the network beats a tuned EKF after a target
manoeuvre** (Annex B §B.0).

**SRD trace**: Annex B (all sections); §2 and §3 as amended by B.6; §4 and §8 (the EKF); §5
(gate G4); §7 (phase 3 row); §9 (blog, results).

**Out of scope**: target speed changes; more than one target turn; non-Gaussian or correlated
bearing error (Annex B B.5 follow-on 3); real data; the time-late variant as a gated model (it is
trained and reported, not gated); changes to the G0–G3 record.

## The claim under test

A causal network, trained on scenarios where the target may turn, estimates the target's range
and course better than an EKF tuned for turns, five minutes after the turn. The hybrid of spec
009 is reported beside it and is not the claim.

## User stories

### US1 — Generate manoeuvring targets (P1)

Generator 0.4.0 (schema bump) adds one target course change per scenario under Annex B §B.2.
`manoeuvre_index` and `manoeuvre_angle_rad` are recorded; held-course scenarios record −1 and 0.

**Acceptance**:
- The target's course changes at the recorded time by the recorded angle, rate-limited; its
  speed is unchanged; the track is continuous.
- Held-course scenarios (20%) are byte-identical in shape to generator 0.3.0's for the same
  parameters (the manoeuvre is additive).
- Determinism and golden tests as for every generator change; G0 re-run and panel.

### US2 — The EKF reference (P1)

`@tma/classical` gains a bearings-only EKF (`ekfPredict`), per timestep, initialised from the
batch solution at the end of ownship's first turn, with process noise as a parameter. A CLI
`tma-ekf` writes a prediction file. A tuning script chooses the two process-noise settings on
the validation split from a declared grid and records them.

**Acceptance**:
- Noise-free: tracks a manoeuvring target to within numerical precision once re-converged.
- Straight targets: agrees with the batch solver at zig + 10 min within the bootstrap interval.
- Both tunings are frozen in the decision record before test scoring.

### US3 — Train, validate, gate (P1)

The carried model (one instantaneous network, declared with its config and forecast in the
decision record) is trained on phase-3 data (fresh seed, reserved). A validation diagnostic
(`tma-g4`, non-test split) is read before any test scoring. Then `tma-g4 --decision` on the test
split, the agent panel, `review.md`, `decided_by`, a results page and a blog post.

## Functional requirements

- **FR-001** (generator). As Annex B §B.2: one course change of 30–120° (sign uniform), rate
  0.5–3°/s, start time uniform between 2 min after `zig_index` and 6 min before the window
  ends; 80% of scenarios manoeuvre. Speed constant. Metadata `manoeuvre_index` (first sample
  after the turn completes; −1 if none) and `manoeuvre_angle_rad` (0 if none).
- **FR-002** (slices). `sliceKeys` gains `manoeuvre=held|30-60deg|60-90deg|90-120deg`.
- **FR-003** (EKF). State (x, y, vx, vy), constant-velocity prediction, bearings-only update
  with wrapped innovation, process noise σ_a (m/s²) as the tuning parameter, measurement noise
  from the scenario's σ. Initialised at `zig_index` from `solveBatch`; rows before that are
  non-converged. Divergence (range outside `PLAUSIBLE`) is reported as non-converged and the
  filter re-initialises from the batch solution, as classical restarts from the grid.
- **FR-004** (tuning). σ_a is chosen from a grid declared in the decision record (for example
  {0.001, 0.003, 0.01, 0.03, 0.1, 0.3} m/s²) by median range error on the validation split:
  tuned-straight on held-course rows at zig + 5 min, tuned-turn on manoeuvring rows at
  manoeuvre + 5 min. The chosen values are frozen in the decision record. No other EKF parameter
  is tuned.
- **FR-005** (features). The feature sets are unchanged. The target's turn is not an input and
  nothing about it enters normalisation (inputs only).
- **FR-006** (training targets). The loss mask covers rows after `zig_index` as now; the truth
  at each row is the target's state at that row, which turns. The velocity parameterisation is
  kept (spec 008).
- **FR-007** (validation rule, Annex A B.3.3). On the validation split, the carried model's
  G4-range and G4-course point estimates must be below 1 with intervals not wholly above 1, and
  G4-control must pass. Otherwise the phase stops at validation and is written up.
- **FR-008** (G4). As Annex B §B.4, implemented in `gate-g4.ts` and `tma-g4`: σ = 1°,
  manoeuvring rows, manoeuvre + 300 s; paired bootstrap ratios of median range and course error
  against the tuned-turn EKF (limit 1), gross-error-rate difference (limit 0), speed ratio
  reported; the G2 checks on held-course rows as the control. FR-015 for each; pass needs all
  gated checks; one re-score on a larger fresh seed if inconclusive.
- **FR-009** (provenance). `tma-g4` binds the committed decision (test seed, carried model
  digests, EKF tunings) and the data's content digest, as `tma-g2` does; it refuses dirty data
  and a second scoring.
- **FR-010** (reporting). Every figure sits beside naive, batch least squares, both EKF tunings
  and the hybrid on the same rows; medians and P90; n and excluded; the curve of each metric
  against time since the manoeuvre.

## Success criteria

- **SC-001**: G0 passes on generator 0.4.0 before training.
- **SC-002**: The EKF's two tunings and the carried model are committed before any test scoring.
- **SC-003**: One scoring of the fresh test seed (plus at most one re-score).
- **SC-004**: The write-up states the outcome against Annex B §B.5 and names the follow-on that
  outcome selects.

## Risks

- **The EKF is the weakest part to get right.** A badly initialised or badly tuned filter makes
  the gate easy. US2's two verifications and the validation-tuned, frozen σ_a are the guards; the
  panel's numerics reviewer re-tunes independently.
- **Five minutes may favour the EKF.** A turn of 30° at 3 kt is nearly invisible in bearings
  for minutes at long range. The gate point is fixed; the curve shows the rest.
- **The network may learn "expect a turn".** The 20% held-course scenarios and G4-control catch
  a model that trades straight-leg accuracy for turn response.
- **Cost.** Generator change, G0, EKF, training and the gate: about iterations 3 and 4 together.
