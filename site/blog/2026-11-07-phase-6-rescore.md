---
title: "Phase 6 re-score: G7 passes, but the intervals are only calibrated on average"
date: 2026-11-07
---

G7 on seed 215 was inconclusive: the fused tracker's 50% range interval covered 48.3%, and its
confidence interval straddled the 48% floor. The rules allow one re-score on a larger fresh seed.
The owner chose to run it. Decision 34 fixed the details before the data existed:

- **What stayed the same:** the tracker, the reference, the frozen models, the multipliers and the
  rules.
- **What changed:** a fresh seed, 216, and a test split of 110,000 scenarios instead of 40,000.
  That is large enough to resolve a coverage of about 48.3% against the floor.
- **The forecast:** about an even chance of passing.

## Result: pass

| Coverage on seed 216 (184,667 G5 rows) | 50%                    | 90%   |
| -------------------------------------- | ---------------------- | ----- |
| Range (log)                            | **48.6%** [48.3, 48.9] | 89.9% |
| Course                                 | 50.5%                  | 90.3% |
| Speed                                  | 49.4%                  | 89.9% |

All nine gated checks pass. The fused tracker's 90% intervals are narrower than the IMM's: 0.73 ×
for range, 0.94 × for course and 0.89 × for speed. This was the one re-score, so the verdict is
final.

## What the pass does and does not show

Five independent reviewers agreed that the pass is correct. One recomputed every value with code
of its own, and another re-ran the gate. All five also agreed on how far the claim goes.

- **Range intervals run about 1.5 points short.** At 50%, the two seeds together give about 48.5%
  [48.3, 48.8]. That is inside the ±2-point tolerance but not centred on 50%. The pass rests on
  the tolerance. The reference IMM, fitted on the same validation data, lands on 50%. So reusing
  validation data does not explain the fused tracker's shortfall.
- **The intervals are calibrated only on the pooled mix of rows.** Range at 50% covers:

  | Rows                                       | Coverage |
  | ------------------------------------------ | -------- |
  | Settled, before any manoeuvre (quiet legs) | 67%      |
  | Settled, after a manoeuvre                 | 39%      |
  | At zig + 5 min                             | 61%      |
  | At zig + 20 min                            | 40%      |

  Seed 215 showed the same pattern within a point.

- **Course and speed intervals are often uninformative.**
  - 17% of course 90% intervals span the whole circle, and the median course 90% interval is
    188° wide. The course width ratio of 0.94 therefore compares two mostly vague intervals.
  - 27% of speed 90% intervals reach below zero.
- **This was a second look.** Over both seeds, the chance of a false pass is about 5% at most, not
  2.5%. A smaller re-score would probably have been inconclusive again.
- **The pass judges these frozen multipliers.** The 0.3-point margin is smaller than the
  multipliers' own sampling error. So the pass does not show that the recalibration procedure works
  in general.

## Phase 6 in one line

On average over the G5 rows, the fused tracker's recalibrated intervals cover roughly what they
say, and they are tighter than the IMM's. Within a regime they do not: the intervals are too wide
on quiet legs and too narrow after a manoeuvre, and its course intervals are often vacuous.
Conditional calibration, for example a multiplier that depends on time since the last manoeuvre,
would be a new design. The owner decides on the follow-on.

Record: `experiments/20261106-p6v-g7/` (verdict, regimes, panel review); decision
`experiments/20261106-p6v-rescore-decision/`; spec 018.
