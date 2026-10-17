# Research: Iteration 3 (spec 007)

## R1 — What the existing gate data says about the owner's ideas (2026-10-17)

These are the 2c carried models' and the classical solver's per-timestep predictions on the
seed-203 test split. That split decided iteration 2c's G2 and is reserved, so reading it again
decides nothing. Speed error is at zig + 600 s, σ = 1°, 3,038 scenarios.

The slices are observational: zig angle, leg-1 length and turn direction are correlated in the
data. They show tendencies, not effects.

**Direction of the first turn.** "Towards" means the turn is to the target's side; "crosses" means
the target ends on the other bow.

| Slice | n | LSTM, kt | BiLSTM, kt | Classical, kt | LSTM range | Classical range |
| --- | --- | --- | --- | --- | --- | --- |
| all | 3,038 | 1.47 | 1.53 | 0.61 | 11.5% | 4.6% |
| towards the target | 1,502 | 1.59 | 1.65 | 0.66 | 13.7% | 5.6% |
| away from the target | 1,536 | 1.36 | 1.45 | 0.59 | 9.7% | 3.7% |
| towards, crossing the line of sight | 258 | 1.41 | 1.61 | 0.42 | 12.9% | 3.2% |
| towards, not crossing | 1,244 | 1.62 | 1.67 | 0.75 | 14.0% | 6.3% |

**Zig size.**

| Slice | n | LSTM, kt | BiLSTM, kt | Classical, kt |
| --- | --- | --- | --- | --- |
| zig 30–50° | 1,058 | 1.65 | 1.74 | 0.86 |
| zig 50–70° | 997 | 1.36 | 1.51 | 0.60 |
| zig 70–90° | 983 | 1.36 | 1.41 | 0.46 |

**Leg-1 length.** The leg-1 0–8 min slice is omitted: it has only 6 scenarios.

| Slice | n | LSTM, kt | BiLSTM, kt | Classical, kt |
| --- | --- | --- | --- | --- |
| leg 1, 8–12 min | 551 | 1.77 | 2.02 | 0.81 |
| leg 1, 12–16 min | 1,133 | 1.42 | 1.44 | 0.63 |
| leg 1, 16 min or more | 1,348 | 1.37 | 1.45 | 0.56 |

**Combined slices.**

| Slice | n | LSTM, kt | BiLSTM, kt | Classical, kt |
| --- | --- | --- | --- | --- |
| crossing, zig ≥ 60° | 160 | 1.38 | 1.43 | 0.39 |
| crossing, leg 1 ≥ 12 min | 192 | 1.32 | 1.43 | 0.36 |
| zig ≥ 70°, leg 1 ≥ 16 min | 437 | 1.28 | 1.31 | 0.43 |
| away, zig ≥ 70°, leg 1 ≥ 16 min | 231 | 1.12 | 1.23 | 0.45 |
| towards, not crossing, zig < 50° | 479 | 1.67 | 1.91 | 0.90 |

**Readings.**

- **Earlier zig.** A shorter leg 1 is worse for every estimator at a fixed time after the zig.
  Gate rows and the training loss already exclude the pre-zig period, so an earlier zig would mainly
  shorten leg 1. It was not chosen.
- **Turning towards the contact.** It helps only when the turn crosses the line of sight; a
  towards-turn that keeps the target on the same bow is the worst case. The useful rule is
  "across the line of sight".
- **Larger turns.** They help every estimator.
- **The gap to classical.** No slice brings the models near classical. Geometry lifts both, but
  the ratio widens: from 2.4× overall to 3.7× in the crossing slices. The models still extract
  less than the bearings carry (Annex A B.1).

The script reproduces from the committed predictions' sources: it regenerates the seed-203
scenarios and reads `data/i2/predictions/test.*.ndjson`.

## R2 — Classical forecast for the iteration-3 ranges (2026-10-17)

The same scratch seed (9001, not a gate seed) was drawn under each set of ranges. These are
classical per-timestep estimates at σ = 1°, 1,500 scenarios each.

| | Iteration-2 ranges | Iteration-3 ranges |
| --- | --- | --- |
| redraws per scenario | 0.00 | 0.21 |
| window, median (p10) | 25.2 (12.7) min | 27.8 (16.5) min |
| first turn, median (p90) | 61° (84°) | 143° (173°) |
| second turn, median | — | 129° |
| reaching zig + 600 s | 61% | 66% |
| classical speed, zig + 300 s, median (p90) | 1.13 (8.98) kt | 0.56 (3.66) kt |
| classical speed, zig + 600 s, median (p90) | 0.67 (4.79) kt | **0.36 (1.92) kt** |
| classical range, zig + 300 s | 7.9% | 3.4% |
| classical range, zig + 600 s | 4.6% | 2.8% |

The new problem roughly halves the classical solver's speed error at both gate times.

**Forecast for the models, recorded before training.** Across R1's slices the LSTM's speed tracks
roughly 1.0 + 0.75 × classical (kt). With classical at about 0.36 kt that gives **1.1–1.3 kt**,
probably still above 1 kt. A pass needs the models, trained on an all-favourable distribution, to
use the extra information better than the 2c models did in iteration 2's most favourable slices
(1.12–1.32 kt). Range and course should improve with classical.

## R3 — Why not an adaptive second zig

The owner's operational rule is to zig again when the estimate is not steady. That needs the
estimator inside the simulation loop: the generator plans ownship's path in advance, and training
data would depend on the model being trained. A scripted second zig 3–5 minutes into leg 2 is the
nearest open-loop equivalent. The viewer could later mark where the rule would have called for a
zig. That is a display-only follow-up, not in this spec.

## R4 — The across-the-line-of-sight rule

Bearings constrain the target through the change in ownship's velocity across the line of sight.
For a turn of angle θ from relative bearing β, the change in that component is
2v |sin(θ/2) cos(β − θ/2)|. It is largest when the turn is symmetric about the line of sight,
which crosses it and reverses the component's sign. That is the standard reason for "turning
across".

The rule is implemented as follows:

- **New course.** The new course is the bearing plus the side of the target times the offset, by
  the shorter turn.
- **Target ahead.** It turns towards the target and through the line of sight.
- **Target on the quarter.** It turns away, through the stern line of sight.

Both cases reverse the across-line-of-sight component.

The rule uses the true bearing, not the observed one: at σ ≤ 2° the difference is small, and it
keeps the parameters a pure function of the draws.
