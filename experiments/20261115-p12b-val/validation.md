# Annex D §D.7 validation: the re-armed composite (spec 025)

**Result: no variant is carried, so §D.7 stops at validation.**
- **Best score.** −0.0314 (W 60, c 3, L 36, σ_p 0.1). The tie rule picks W 60, c 3, L 36, σ_p 0.2
  (−0.0338).
- **Against the first design.** That design scored −0.0134, so re-arming is worse.
- **Seeds.** 229–230 are never generated, and no G9 is scored.

**Data and inputs.** These are §D.6's:
- seed 217's validation split with realistic error, giving 16,711 G5 rows (4,205 on straight legs);
- the per-timestep least-squares file;
- the frozen `-g1` fused tracker.

Hashes are in `inputs.sha256`.

**Pre-registration.** §D.7, the grid script and `run.sh` were committed in 4b3e978, before the run.

## The grid (scores; the full point ratios are in `grid.json`)

| (W, c) \ (L, σ_p) | 18, 0.1 | 18, 0.2 | 36, 0.1 | 36, 0.2 | 60, 0.1 | 60, 0.2 |
| --- | --- | --- | --- | --- | --- | --- |
| 6, 8 | −0.112 | −0.110 | −0.075 | −0.075 | −0.042 | −0.041 |
| 60, 3 | −0.032 | −0.034 | **−0.031** | −0.034 | −0.042 | −0.043 |
| 30, 4 | −0.113 | −0.113 | −0.088 | −0.090 | −0.053 | −0.055 |
| 12, 6 | −0.125 | −0.123 | −0.091 | −0.090 | −0.058 | −0.058 |

**Every (W, c) pair does worse than without re-arming.** A shorter leg (smaller L), which hands
back sooner, does worst.

## The chosen variant's diagnostic (95% intervals)

| Check | Ratio | 95% CI | Limit | Result |
| --- | --- | --- | --- | --- |
| Range / fused tracker | 0.987 | [0.965, 1.014] | < 1 | inconclusive |
| **Course / fused tracker** | **1.034** | [1.008, 1.063] | < 1 | **fail** |
| Straight-leg range / least squares | 1.025 | [1.000, 1.041] | < 1.1 | pass |
| Straight-leg course / least squares | 1.099 | [1.063, 1.130] | < 1.1 | inconclusive |
| Straight-leg speed / least squares | 1.067 | [1.032, 1.095] | < 1.1 | pass |
| Speed / fused tracker (reported) | 0.874 | [0.852, 0.896] | — | — |

## Why (`slices.json`, `scripts/research/spec025-rearm-slices.mjs`)

**Row sources and medians:**

| Rows | Least squares / fused tracker / re-armed leg | Re-armed: range, course | First design | Fused tracker |
| --- | --- | --- | --- | --- |
| Straight legs (4,205) | 94% / 5% / 0.3% | 7.1%, 2.2° | 7.1%, 2.2° | 9.4%, 9.0° |
| After a manoeuvre (12,031) | **44%** / 51% / 5% | 15.8%, 43.4° | 15.3%, 42.6° | 14.5%, 37.7° |
| Settled, after a manoeuvre (3,304) | 29% / 62% / 10% | 17.4%, 24.9° | 16.6%, 24.3° | 15.1%, 22.4° |

**On the rows they cover, the re-armed legs are worse than the fused tracker:**

| Leg rows | Range | Course | Speed |
| --- | --- | --- | --- |
| Re-armed leg (659 rows) | 30.6% | 48.6° | 5.9 kt |
| Fused tracker, same rows | 15.6% | 35.4° | 3.0 kt |

1. **A new leg passes the fit check while wrong.** Without another ownship manoeuvre, many
   tracks fit a short leg's bearings equally well. The anchor fixes the range at the leg's
   start, but not the velocity. A small residual does not mean a right answer, so the check
   cannot tell a good leg from a wrong one.
2. **Re-arming does not touch what cost the first design G9.** 44% of rows after a manoeuvre
   still report the original least-squares fit before the check trips. That is unchanged.
3. **False alarms now cost more.** After a false switch on a straight leg, a re-armed leg
   sometimes replaces the fused tracker's row. Straight-leg course rises to 1.099 × least squares'.

## Reading

- **Re-arming makes the composite worse,** and the more often it hands back, the worse it gets.
- **A residual fit check cannot certify a new leg** when the leg alone does not make the target
  observable. That is the bearings-only observability limit, and it is the same reason least
  squares needs an ownship manoeuvre at all.
- **Both composite designs miss G9 on course.** The first design misses by 1.3% and the re-armed
  one by 3.4%.
- **Limits.** One family of switch and leg rules, validation only, and the seventh selection on
  seed 217.

**Next: the owner decides.** The first design's G9 shortfall (§D.6) stands as Annex D's result.
