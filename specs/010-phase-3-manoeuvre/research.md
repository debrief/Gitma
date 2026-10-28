# Research plan: Phase 3 — manoeuvring targets

Questions to answer before the decision record is committed. Each is read-only on existing data
or on validation splits; no test split is read.

## R1 — How visible is a target turn in bearings?

On generator 0.4.0 validation data at σ = 1°: for each manoeuvre angle band and range band, the
time after the turn at which the bearing residual from the pre-turn constant-velocity fit exceeds
3σ. This sets expectations for the 5-minute gate point and for the detection follow-on.

## R2 — EKF tuning curves

Median range and course error of the EKF against σ_a on the validation split, separately for
held-course rows at zig + 5 min and manoeuvring rows at manoeuvre + 5 min. The two minima are the
two tunings (FR-004). Also: how far apart they are, which measures the EKF's dilemma that the
network is meant to escape.

## R3 — What the iteration-4 LSTM does on a turn, untrained

The frozen iteration-4 LSTM on generator 0.4.0 validation data. Its error after a turn, against
the tuned-turn EKF. This is the floor: what a network that never saw a turn does. The forecast
for the retrained model is set relative to it.

## R4 — Forecast

From R1–R3: the expected G4-range and G4-course ratios with intervals, and P(G4 pass), recorded
in the decision record before training.
