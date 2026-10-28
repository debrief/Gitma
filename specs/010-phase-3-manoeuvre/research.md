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

---

# Results (seed-208 validation split, 10,000 scenarios; generated at 05aaade)

All on σ = 1°. The split has 4,074 turning and 1,042 held-course scenarios at that noise level.
Every turning scenario reaches manoeuvre + 300 s.

## R1 result — a turn shows in the bearings about two minutes after it ends

Method (`scripts/research/spec010-r1-visibility.mjs`):
1. Fit batch least squares to the bearings before the turn starts.
2. Find the first sample after the turn starts where three consecutive valid bearings each depart
   from that fit by more than 3σ.
3. Report that time relative to the end of the turn.

| Slice | n | Median s after turn end | P90 | Detected by manoeuvre + 300 s |
| --- | --- | --- | --- | --- |
| all | 4074 | 130 | 750 | 80.4% |
| 30–60° | 1426 | 200 | never | 69.5% |
| 60–90° | 1313 | 120 | 410 | 85.0% |
| 90–120° | 1335 | 90 | 360 | 87.4% |
| 0–5 km | 725 | 60 | 230 | 93.5% |
| 5–10 km | 1561 | 110 | 380 | 86.0% |
| 10–20 km | 1575 | 190 | never | 71.8% |
| 20–40 km | 213 | 270 | never | 57.7% |

**Reading it.**
- **The turn is still news at the gate.** Five minutes after the turn ends, it has just become
  visible in a typical scenario. In one in five it is not yet distinguishable from noise by this
  test.
- **Some G4 rows barely depend on the turn.** In those scenarios the pre-turn estimate is still
  roughly right, so any estimator does well. They dilute G4's ratios towards 1, more for small
  turns and long ranges.
- **The detection follow-on (Annex B §B.5) has room.** A CUSUM on innovations would be the
  baseline for detection delay.

## R3 result — a network that never saw a turn

The frozen iteration-4 LSTM (`experiments/20261025-i4-g2-rescore/models/lstm-instantaneous`),
using its own normalisation, on this split:

| Rows | n | Median range error | P90 | Median course error | Median speed error |
| --- | --- | --- | --- | --- | --- |
| Turning, last sample before the turn | 4074 | 7.2% | 20.0% | | |
| Turning, manoeuvre + 300 s | 4074 | 26.1% | 60.2% | 53.2° | 2.85 kt |
| Held course, zig + 300 s | 1042 | 6.4% | 18.2% | | |

**Reading it.**
- **It is lost after a turn.** Its median course error is 53°: it keeps reporting the pre-turn
  track.
- **Retraining has to teach the turn.** Retraining on phase-3 data must teach both detection and
  the new course. Holding course, it is as good as on iteration-4 data.
