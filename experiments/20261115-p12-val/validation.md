# Annex D validation: the composite solver (spec 025, SRD Annex D §D.2)

**Result: no variant is carried, so Annex D stops at validation.** The best score is −0.0134
(W 6, c 8). The binding check is overall course against the fused tracker, at 1.013. Seeds
229–230 are never generated, and no G9 is scored.

**Data.** Seed 217's validation split with realistic bearing error: 16,711 G5 rows, of which 4,205
are straight-leg rows.

**Inputs.**
- Least squares at every timestep, computed here (`tma-solve --per-timestep --workers 4`).
- The frozen `-g1` fused tracker from `experiments/20261114-p11-val/`.

Input hashes are in `inputs.sha256`.

**Pre-registration.** SRD Annex D, spec 025, the grid script and `run.sh` were committed in
6e2252c, before the run.

## The grid (point ratios; the score is the smallest margin)

| W \ c | 2 | 3 | 4 | 6 | 8 | 12 |
| --- | --- | --- | --- | --- | --- | --- |
| 6 (1 min) | −2.97 | −2.27 | −1.11 | −0.10 | **−0.013** | −0.066 |
| 12 (2 min) | −2.79 | −1.28 | −0.25 | −0.034 | −0.073 | −0.14 |
| 30 (5 min) | −2.33 | −0.27 | −0.031 | −0.11 | −0.17 | −0.22 |
| 60 (10 min) | −1.85 | −0.019 | −0.078 | −0.16 | −0.20 | −0.26 |

Every point ratio is in `grid.json`.

**How the trade-off runs:**

- **At low thresholds the check switches too early.** False alarms from the correlated error and
  bias move straight-leg rows to the fused tracker (straight-leg course up to 4.4 × least
  squares').
- **At high thresholds it switches too late.** Least squares stays in use after a manoeuvre, and
  overall course rises to 1.26 × the fused tracker's.
- **No setting satisfies both,** and the best variant misses by 1.3% on overall course.

## The chosen variant's diagnostic (W 6, c 8; 95% intervals)

| Check | Ratio | 95% CI | Limit | Result |
| --- | --- | --- | --- | --- |
| Range / fused tracker | 0.964 | [0.943, 0.986] | < 1 | pass |
| **Course / fused tracker** | **1.013** | [0.993, 1.039] | < 1 | **inconclusive** |
| Straight-leg range / least squares | 1.021 | [1.000, 1.036] | < 1.1 | pass |
| Straight-leg course / least squares | 1.069 | [1.038, 1.095] | < 1.1 | pass |
| Straight-leg speed / least squares | 1.040 | [1.015, 1.066] | < 1.1 | pass |
| Speed / fused tracker (reported) | 0.852 | [0.829, 0.872] | — | — |

## Where the composite gains and loses (`slices.json`, `scripts/research/spec025-slices.mjs`)

Medians at W 6, c 8:

| Rows | Composite | Fused tracker | Least squares |
| --- | --- | --- | --- |
| Straight legs (4,205): range, course, speed | 7.1%, 2.1°, 0.87 kt | 9.4%, 9.0°, 1.56 kt | 6.9%, 2.0°, 0.83 kt |
| After a manoeuvre (12,031): range, course, speed | 15.2%, 42.2°, 2.97 kt | **14.5%, 37.7°**, 3.12 kt | 24.8%, 68.3°, 3.44 kt |
| All G5 rows: range, course, speed | **12.5%**, 26.8°, **2.24 kt** | 13.0%, **26.5°**, 2.63 kt | 17.3%, 46.3°, 2.44 kt |

- **On straight legs the composite works.** It keeps least squares' accuracy, at 4 × better
  course than the fused tracker.
- **After a manoeuvre it pays for detection delay.** Until the fit check trips, it reports least
  squares' stale constant-velocity solution. Its course is 12% worse than the fused tracker's
  there, and range 5% worse.
- **Overall it wins on range and speed but not on course.** About 60% of rows come from least
  squares.

**A reporting slip, corrected.** The grid script reported the share of rows taken from least
squares as 0. It compared re-parsed rows by identity. The shares above come from
`spec025-slices.mjs`, and the slip does not affect any score.

## Reading

- **What blocks it is the switching delay, not the design.** Manoeuvre detection from bearings
  is slow: phase 5's CUSUM caught only 28% of course changes within 5 minutes. A fit check is no
  faster.
- **The composite's course gain on straight legs is real but cannot pay for that.** Most G5 rows
  come after a manoeuvre (12,031 of 16,711).
- **Limits.** One family of switch rules, one error model, validation only, and the sixth
  selection on seed 217.

**Next: the owner decides.** Other routes remain open:
- a gate that judges straight legs and post-manoeuvre rows separately;
- a switch that also returns to least squares on a new leg;
- reporting the speed gain (0.85 × the fused tracker's) as the composite's main benefit.

Each would need a new decision.
