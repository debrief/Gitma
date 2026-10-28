# Research plan: Phase 3 — manoeuvring targets

Questions to answer before the decision record is committed. Each is read-only on existing data
or on validation splits; no test split is read.

## R1 — How visible is a target turn in bearings?

On generator 0.4.0 validation data at σ = 1°: for each manoeuvre angle band and range band, the
time after the turn at which the bearing residual from the pre-turn constant-velocity fit exceeds
3σ. This sets expectations for the 5-minute gate point and for the detection follow-on.

## R2 — Tracker tuning curves

Median range and course error of the IMM (and the single EKF) against their parameters on the
validation split, separately for
held-course rows at zig + 5 min and manoeuvring rows at manoeuvre + 5 min. The two minima are the
two tunings (FR-004). Also: how far apart they are, which measures the tracker's dilemma that the
network is meant to escape. Also the tuned IMM's straight-target figures against the batch
solver's at zig + 10 min (US2). The grid must include low switch rates (down to 10⁻⁵/s) and
σ_cv = 0: at σ = 1° a switch rate of 10⁻³/s makes the IMM 1.8 × batch least squares on straight
legs (G0 panel round 1).

## R3 — What the iteration-4 LSTM does on a turn, untrained

The frozen iteration-4 LSTM on generator 0.4.0 validation data. Its error after a turn, against
the tuned-turn IMM. This is the floor: what a network that never saw a turn does. The forecast
for the retrained model is set relative to it.

## R4 — Forecast

From R1–R3: the expected G4-range and G4-course ratios with intervals, and P(G4 pass), recorded
in the decision record before training.
