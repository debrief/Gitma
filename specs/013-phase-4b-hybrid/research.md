# Research: Phase 4b — the tracker hybrid

Data: seed 211's validation split, 16,500 G5 rows (σ = 1°, zig + 5/10/15/20 min) in 4,951
scenarios; the frozen IMM reference and the frozen T2 predictions from
`experiments/20261031-p4-val/`. Outputs: `experiments/20261101-p4h-research/`.

## R1 Where each estimator wins

From the phase-4 validation record:
- **T2 wins on range everywhere it matters.** Overall 0.85 × the IMM, settled 0.97 ×.
- **T2 wins on velocity after manoeuvres** (course 0.84 × overall) but loses on straight
  segments: settled course 1.44 ×, settled speed 1.66 ×, and on held-course scenarios 1.88 kt
  against the IMM's 0.69 kt.
- **So a hybrid should take range from T2 and velocity from whichever is better at that row.**
  The IMM lags a manoeuvre by minutes; while it lags, its course and T2's disagree. A large
  course disagreement is therefore a causal sign that a manoeuvre is in progress or recent.
- **T2's stated velocity sd does not separate the cases.** Switching on it (0.5–2 m/s) took T2's
  velocity on 89–100% of rows and kept T2's settled failures (`rules.json`).

## R2 The rule and θ

Rule: T2's range always; T2's course and speed where |course_IMM − course_T2| > θ, else the IMM's
(`scripts/research/spec013-hybrid.mjs`, `rules.json`). Ratios of medians to the IMM:

| θ | Velocity from T2 | Overall range | Overall course | Settled range | Settled course | Settled speed | Smallest margin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20° | 45% | 0.848 | 0.825 | 0.976 | 1.091 | 1.113 | −0.012 |
| 30° | 30% | 0.848 | 0.836 | 0.976 | 1.003 | 1.018 | 0.075 |
| 40° | 18% | 0.848 | 0.881 | 0.976 | 0.979 | 0.997 | 0.094 |
| **45°** | 13% | 0.848 | 0.903 | 0.976 | 0.983 | 0.992 | **0.097** |
| 50° | 11% | 0.848 | 0.920 | 0.976 | 0.983 | 0.986 | 0.080 |
| 60° | 7% | 0.848 | 0.939 | 0.976 | 0.987 | 0.993 | 0.061 |

- **The declared criterion** (Annex C §C.10) picks **θ = 45°**.
- **The choice is a plateau, not a spike.** Every θ from 25° to 90° passes all five checks on
  point estimates. Below 25° the hybrid takes too much of T2's straight-leg velocity.
- **The trade.** Lower θ buys overall course (more of T2's post-manoeuvre advantage) and pays in
  settled course and speed.

**The hybrid at θ = 45° on validation** (`tma-g5`, `diagnostic.json`; in-sample, since θ was chosen
here):

| Gated check | Hybrid / IMM, 97.5% CI | Limit |
| --- | --- | --- |
| Overall range | 0.847 [0.816, 0.878] | < 1 |
| Overall course | 0.897 [0.875, 0.922] | < 1 |
| Settled range | 0.973 [0.917, 1.032] | < 1.1 |
| Settled course | 0.982 [0.963, 0.998] | < 1.1 |
| Settled speed | 0.991 [0.970, 1.013] | < 1.1 |
| Reported: overall speed | 0.991 [0.976, 1.007] | |
| Reported: gross-error rate, hybrid − IMM | −3.5 pp [−4.1, −2.9] | |

Medians: overall range 7.8%, course 20.7°, speed 1.89 kt; settled 7.0%, 7.3°, 1.29 kt; held course
5.8%, 3.7°, 0.70 kt.

## R3 Risks

- **Overfitting θ.** Chosen on these rows; the margin is about 10% and the plateau wide, but only
  the fresh seed decides.
- **Settled range rests on T2 alone.** Its upper bound on validation is 1.03, inside the 1.1 limit
  with 0.07 to spare.
- **Distribution shift between seeds** should be small: seed 213 uses the same generator and ranges.
