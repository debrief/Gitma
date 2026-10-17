---
title: "Iteration 2c: G2 failed on speed; the project stops at G2"
date: 2026-10-17
---

Iteration 2c was the last attempt the SRD allows under G2. It combined the two levers that each
moved speed on validation, a speed-weighted loss and twice the model capacity, and judged G2 on a
third fresh test split. Range and course are the best of the project. Speed is not within reach.

**Verdict: G2 failed** (agent review panel, round 2, no rejections). Under SRD §7 the project stops at G2:
**no-go.**

- **Range passes** for both models: 13.5% [13.0, 13.9] instantaneous and 12.1% [11.7, 12.6]
  time-late at zig + 300 s on the σ = 1° slice, against 20%.
- **Course passes for both:** 7.36° [7.05, 7.70] and 6.12° [5.87, 6.41], against 10°.
- **Speed fails for both:** 1.47 kt [1.37, 1.52] and 1.53 kt [1.47, 1.61] at zig + 600 s, against
  1 kt. Only 37% and 33% of scenarios are under 1 kt. Classical least squares reaches 0.61 kt on
  the same scenarios, at the Cramér–Rao bound.

Experiment of record:
[`experiments/20261016-i2d-g2/`](https://github.com/debrief/Gitma/tree/main/experiments/20261016-i2d-g2).
Curves and slices: [iteration-2c results](/docs/results/iteration-2c).

<!-- truncate -->

## What changed

Iteration 2b showed that weighting speed 4× in the loss moved speed by 0.3 kt; the
[capacity scan](https://github.com/debrief/Gitma/tree/main/experiments/20261014-i2s-scan) showed
that a two-layer 128-unit LSTM reaches the 96-unit model's plateau in half the epochs. SRD §7 was
amended on 2026-10-15, after 2b's validation result and before its test scoring, to allow one
further iteration combining the two, then stop (decisions 18–20, spec 005).

- **Model.** Two stacked recurrent layers of 128 units (203k parameters for the LSTM, 538k for the
  BiLSTM, against 41k and 123k before), trained from scratch; the CNN and MLP controls at their
  sizes.
- **Loss.** Speed weighted 4×, as in 2b.
- **Fresh test split.** Seed 203, pinned by content digest in the plan; seeds 201 and 202 decided
  the earlier attempts; all three are now reserved in the plan checker.
- **Cost.** The BiLSTM took 27.5 runner-hours over five chained jobs in two runs; the LSTM
  12.6 hours. Per-epoch cost rose 1.4× and 2.2× against 2b.

The decision record, with a forecast of 1.4–1.6 kt, was committed four hours before training
started. Validation gave 1.42 / 1.52 kt; the test split gave 1.47 / 1.53 kt.

## Results on the seed-203 test split (σ = 1°)

| Estimator                         | Range, zig+300 s       | Course, zig+300 s      | Speed, zig+600 s     |
| --------------------------------- | ---------------------- | ---------------------- | -------------------- |
| G2 threshold                      | < 20%                  | < 10°                  | < 1 kt               |
| lstm-instantaneous (2c)           | **13.5%** [13.0, 13.9] | **7.36°** [7.05, 7.70] | 1.47 kt [1.37, 1.52] |
| bilstm-time-late (2c)             | **12.1%** [11.7, 12.6] | **6.12°** [5.87, 6.41] | 1.53 kt [1.47, 1.61] |
| lstm-instantaneous (2b, reported) | 15.3%                  | 8.27°                  | 1.78 kt              |
| bilstm-time-late (2b, reported)   | 15.8%                  | 9.12°                  | 1.77 kt              |
| classical                         | 8.8%                   | 3.41°                  | 0.61 kt              |
| naive                             | 37.2%                  | 90.5°                  | 4.44 kt              |

n = 4,689 scenarios at zig + 300 s (93% of the slice) and 3,038 at zig + 600 s (60%).

The repeated G1 checks: both models at 0.35–0.39 × naive on range (pass); controls beaten;
shuffled labels at 1.027 × naive (pass). The time-late model is, for the first time, better than
the instantaneous one on range and course, and worse on speed; its "not worse" check fails at
three late points without an interval (the paired intervals contain the slack), the deficit late,
largest at σ = 2° and worst near the window end.

## The trend, and why it stops here

| Attempt                 | Change                                      | Speed, instantaneous | Speed, time-late |
| ----------------------- | ------------------------------------------- | -------------------- | ---------------- |
| Iteration 2 (seed 201)  | G1 models, longer training                  | 2.09 kt              | 2.38 kt          |
| Iteration 2b (seed 202) | speed weight 4, continued                   | 1.77 kt              | 1.77 kt          |
| Iteration 2c (seed 203) | 2 × 128 units, from scratch, speed weight 4 | 1.47 kt              | 1.53 kt          |

Each step moved the instantaneous model's speed by about 0.3 kt (the time-late model's by 0.6 kt
then 0.24 kt), and the 2c-over-2b gain is real: on the same seed-203
rows the paired difference is −0.31 kt [−0.41, −0.23] for the instantaneous model and −0.24 kt
[−0.32, −0.15] for the time-late one. But a pass needs the whole interval below 1 kt, a median of
about 0.93 kt: a further 37%, more than both steps combined. The panel's statistics reviewer put
it this way, and the panel adopted it as the no-go statement:

> On the fresh seed-203 test split the instantaneous model's median speed error is 1.47 kt
> (95% CI 1.37–1.52) and the time-late model's 1.53 kt (1.47–1.61): 12 and 14 standard errors
> above the 1 kt threshold, with only 37% / 33% of scenarios under 1 kt; the interval would
> still exclude 1 kt with as few as about 80 scenarios (56 for the time-late model). Range and
> course pass with wide margins. Each iteration moved speed by about 0.3 kt and the result
> matched validation and the pre-recorded forecast; reaching the gate would need a further 37%,
> larger than both steps combined, from a capacity lever the scan already showed flat (at 30
> epochs with speed weight 1: 192 units 2.25 kt, 2 × 128 units 2.24 kt) and a loss-weight lever
> that bought 15%. Classical least squares reaches 0.61 kt on the same rows,
> at the Cramér–Rao bound: the information is in the data; this family of models does not
> extract it. Caveats: three different test splits across iterations (split-to-split differences
> at most 1.4 standard errors), one training seed per model, two levers tried.

## What the models did and did not learn

The panel's geometry and numerics reviewers agree on the shape of the failure.

- **Speed error does not follow the geometry.** By true range at zig + 600 s the model's error is
  1.2–2.0 kt in every band, where classical's falls from 1.6 kt at 20–40 km to 0.1 kt under 2 km.
  By bearing rate it is flat at 1.3–1.8 kt against classical's 0.4–0.9, and the ratio to
  classical is largest, 3.7×, in the best-observed band (above 1°/min). By range the ratio
  reaches 16× below 3 km. Against the per-scenario Cramér–Rao bound the models' median
  error-to-bound ratio is 1.30, where classical's is 0.66 and an efficient estimator's 0.67, so
  about twice an efficient estimator in the median and nine times the bound below 3 km.
- **The gains were uniform shifts.** The 2c improvement over 2b is −0.2 to −0.3 kt in every range
  band and at every time. By true speed it came from the bands away from the population mean
  (3–9 kt and 15–18 kt); 9–15 kt and 18–20 kt moved by under 0.1 kt. That is eased regression to
  the mean (slope of prediction on truth 0.65 → 0.71, about 16% less shrinkage); scatter fell by
  only 5–9% (2.23 → 2.11 kt). The term that has to move is the one that moved least.
- **The floor is scatter.** With every speed-dependent bias removed the median error would still
  be 1.35 kt. A bidirectional model that sees the whole window did no better on speed than the
  causal one.
- **Outside the training range band there is no speed information.** On held-out scenarios
  starting at 20–30 km the models' speed error is 3.4 kt at zig + 600 s, 0.8 × the naive prior,
  and classical's 3.6 kt is no better. Five minutes after the zig the models beat classical on all
  three quantities there, because classical fails to converge on a quarter of those scenarios; ten
  minutes after, classical leads on range and course.
- **Range and course are a different story.** They follow the bearing-line geometry the network
  reads, and five minutes after the zig the time-late model is ahead of classical beyond 10 km
  and at σ = 2° (14.0% / 7.3° / 1.86 kt against 17.1% / 7.4° / 2.29 kt). That lead is robustness
  to non-convergence: classical fails to converge on 10–16% of those scenarios and is scored
  infinite there, while on the scenarios it does solve its course is the better one. Given ten
  minutes, classical leads everywhere. That early robustness is the project's positive result,
  and it is not what G2 asks.

Speed from bearings is second-order information: it lives in how the bearing rate changes as
ownship manoeuvres. Classical least squares uses it explicitly; the networks, given raw bearings
and ownship states, learn a population prior refined by about two knots of scatter.

## What the panel found

Five reviewers, two rounds. Round 1 returned approve-with-findings from all five with no blocker
or major finding; every reviewer reproduced the speed medians independently, the reproducibility
reviewer re-gated, re-evaluated and re-predicted byte for byte, and the red team found no path
from a pipeline error to the verdict. Round 2 approved with wording minors only; the
corrections are in this post. Record:
[`review.md`](https://github.com/debrief/Gitma/blob/main/experiments/20261016-i2d-g2/review.md).

Nineteen minor findings were answered or fixed. Two are worth repeating: the output scale for
speed (ownship's 15 kt maximum) puts targets above 15 kt beyond the normalised range, where the
models shrink most (not saturation: the head is linear and predictions reach 19.9 kt), and this
lead was never tried; and the models were trained with one seed each,
so seed-to-seed variation in these medians is unmeasured.

## What was not tried

Within the SRD's hyperparameter cap, three leads stayed on the table:

1. Derived features (bearing rate and the bearing-line intercept), built in iteration 2 and never
   trained on.
2. Rescaling the speed target to unit variance, or a dedicated speed head.
3. A per-leg steady-track fit as an input or an auxiliary target, giving the network the
   second-order quantity it does not extract.

None of them is a lever the record shows moving speed, and the SRD's budget is spent. A follow-on
would need a pre-registered validation result with the whole interval below about 0.9 kt from at
least two training seeds before another test split is scored.

## Where this leaves the question

The SRD asked whether a network trained on simulated bearings-only data can produce usable range,
course and speed. On range and course, yes, with intervals well inside the thresholds and, early in the track, better
robustness to least squares' non-convergence. On speed, no: three iterations
reduced the error from 2.1 to 1.5 kt against a 1 kt threshold that classical meets with margin.
The gate is failed and the project stops at G2.
