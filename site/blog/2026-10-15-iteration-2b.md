---
title: "Iteration 2b: speed-weighted loss, G2 failed again"
date: 2026-10-15
---

Iteration 2b asks one question: does weighting speed in the loss get the iteration-2 models to the
G2 speed threshold? It changes nothing else, and judges G2 on a fresh test split.

**Verdict: G2 failed** (agent review panel, round 2, no rejections).

- **Range passes** for both models: 14.6% [14.1, 15.2] instantaneous and 15.8% [15.2, 16.2]
  time-late at zig + 300 s on the σ = 1° slice, against 20%.
- **Course passes for both:** 8.22° [7.88, 8.54] and 8.66° [8.29, 9.03], against 10°. The
  time-late course failure of iteration 2 is gone.
- **Speed fails for both, by less:** 1.77 kt [1.68, 1.83] and 1.77 kt [1.67, 1.86] at
  zig + 600 s, against 1 kt. The same weights before 2b, scored on the same scenarios, were at
  2.02 kt and 2.31 kt. Classical reaches 0.60 kt.

Experiment of record:
[`experiments/20261015-i2c-g2/`](https://github.com/debrief/Gitma/tree/main/experiments/20261015-i2c-g2).
Curves and slices: [iteration-2b results](/docs/results/iteration-2b).

<!-- truncate -->

## What changed

The SRD allows one more round after a stalled G2. Iteration 2 left three leads (research R19):
derived features, speed in the loss, and the training budget. The user chose the loss (decisions
15–17 in spec 004):

- **Loss weight.** The speed term of the loss is weighted 4× (`loss_weight_speed: 4`). Speed
  contributed about 15% of the loss before; now it is about 40%.
- **Continued, not restarted.** Every model (the two carried ones and the three controls) starts
  from its committed phase-B weights, to 220 epochs at most with patience 6. Because the loss
  changed, `tma-train` re-scores the best epoch under the new loss before it resumes; otherwise
  the old best, on the old scale, could never be beaten and the old weights would be kept.
- **A fresh test split.** The iteration-2 test split (seed 201) decided the first attempt and is
  never scored again. The gate is judged on the test split of seed 202, generated with the same
  count and ranges and pinned by content digest in the training plan. Train and validation are
  unchanged.

Three tooling checks promised at the end of iteration 2 arrived with 2b and were on for this
gate: `tma-g2` checks the plan's content digests itself, refuses a phase decision that is not a
git ancestor of the carried weights, and checks that every estimator was scored on the same rows,
not just the same number of them. The [evaluation](/docs/evaluation) page describes them.

The carried set was fixed before training: the 2b models, unconditionally. Phase B is scored
beside them on the fresh split and reported, never gated.

## Results on the fresh test split (σ = 1°)

| Estimator                        | Range, zig+300 s       | Course, zig+300 s      | Speed, zig+600 s     |
| -------------------------------- | ---------------------- | ---------------------- | -------------------- |
| G2 threshold                     | < 20%                  | < 10°                  | < 1 kt               |
| lstm-instantaneous (2b)          | **14.6%** [14.1, 15.2] | **8.22°** [7.88, 8.54] | 1.77 kt [1.68, 1.83] |
| bilstm-time-late (2b)            | **15.8%** [15.2, 16.2] | **8.66°** [8.29, 9.03] | 1.77 kt [1.67, 1.86] |
| lstm-instantaneous (B, reported) | 16.5%                  | 9.20°                  | 2.02 kt              |
| bilstm-time-late (B, reported)   | 19.2%                  | 10.36°                 | 2.31 kt              |
| classical                        | 8.5%                   | 3.31°                  | 0.60 kt              |
| naive                            | 37.9%                  | 90.4°                  | 4.22 kt              |

n = 4,682 scenarios at zig + 300 s (93% of the slice) and 2,973 at zig + 600 s (59%).

Phase B's numbers here differ from the iteration-2 verdict (2.09 / 2.38 kt) because this is a
different split; the intervals overlap.

### The repeated G1 checks

| Check                                  | Result                                   |
| -------------------------------------- | ---------------------------------------- |
| instantaneous / naive < 0.5            | pass: 0.418 [0.405, 0.432]               |
| time-late / naive < 0.5                | pass: 0.430 [0.419, 0.443]               |
| time-late not worse than instantaneous | fail: 2 of 19 points (t = 840 and 960 s) |
| both models beat their controls        | pass                                     |
| shuffled-label model at naive          | pass: 1.000 ×                            |

The time-late model's knife-edge G1 fail from iteration 2 (0.514) is now a clear pass. Its
deficit since G1 was a training deficit, not an architectural one: given the same budget it
matches the instantaneous model on every check. The "not worse" check has no interval; the two
exceedances (ratios 1.055 and 1.056 against 1.05) have paired intervals that contain 1.05, so
this fail is not distinguishable from a pass. What is real is the G1 caveat persisting: the
time-late model is slightly worse than the instantaneous one at 17 of 19 points, not better.

## What the speed weight did, and did not do

- **Speed moved by 12–23%** (2.02 → 1.77 kt; 2.31 → 1.77 kt), and range and course improved with
  it. Nothing got worse.
- **It is still 1.8 kt against 1 kt**, with the whole interval above 1.67 kt. The models are
  about three times classical, which is at the Cramér–Rao bound on these bearings: the panel
  recomputed the per-scenario bound on this split (median 1.05 kt for the bearings to
  zig + 600 s) and classical's error is 0.62 of it at the median, where an efficient estimator
  gives 0.67.
- **The gain is less scatter as much as less shrinkage.** The slope of predicted on true speed
  rose from 0.58 to 0.65 and the residual spread fell from 2.38 to 2.21 kt; correcting the
  shrinkage alone would not help (it would give 2.3 kt). Target speeds above ownship's 15 kt map
  to normalised targets above 1, where the shrinkage is worst; the output scaling was not changed.
- **The gap is where classical is near-perfect.** By true range at zig + 600 s (all noise):

| True range         | Instantaneous | Time-late | Classical |
| ------------------ | ------------- | --------- | --------- |
| 2–5 km (n 731)     | 1.44 kt       | 1.43 kt   | 0.17 kt   |
| 5–10 km (n 2,219)  | 1.55 kt       | 1.53 kt   | 0.57 kt   |
| 10–20 km (n 2,568) | 2.12 kt       | 2.01 kt   | 1.51 kt   |
| 20–30 km (n 420)   | 2.98 kt       | 3.08 kt   | 3.54 kt   |

Classical's 0.60 kt median is carried by the short ranges, where a few hundred metres of range
error fixes speed to a fraction of a knot. The models are 1.4–1.5 kt there, flat across bands
they resolve well, and only beyond 20 km do they beat classical on speed.

- **The range advantage beyond 10 km is narrower than iteration 2 suggested.** At zig + 300 s
  the models are ahead at 10–20 km (14.2% against 18.6%, all noise) and at 20–30 km (24.1%
  against 27.4%), but the gap is carried by classical's non-converged tail (117 of 1,806 scenarios
  at 10–20 km on the σ = 1° slice, scored as infinite error). On converged scenarios alone the two
  are level, and at zig + 600 s classical is better in every band.

## What the panel found

Five reviewers again: TMA geometry, estimation and numerics, evaluation statistics,
reproducibility, and red team. All five returned approve-with-findings in round 1, and none
rejected. Every one of them reproduced the speed medians independently, and none found a path
from a pipeline error to the verdict.

**One latent major, fixed.** When a continuation changes the loss, `tma-train` re-scores the best
weights under the new loss before it resumes. It used that value in memory but never wrote it to
the manifest, so a chained job (resuming with its optimizer state) compared new-loss epochs against
the old-loss number. Had a continuation's first job ended before any epoch beat the re-scored
value, later jobs would have kept the old weights silently. It did not happen in this run (the
reviewer checked every job boundary in the CI logs), but it could have. The manifest now records
the value a later epoch must beat and the source of a continuation, a chained-job test covers the
case, and `tma-train --check` verifies that a finished continuation's kept weights are explained
by its record.

**What else the panel established:**

- The fresh split is fresh: per-scenario seeds derive from the dataset seed and index, a seed-201
  and seed-202 collision would need an index difference of 10¹⁸, and no test scenario shares a
  seed or parameter set with any of the 100,000 seed-201 scenarios.
- The fail margin is 16–20 standard errors. Only 30% of scenarios have a speed error under 1 kt;
  for the interval merely to touch the threshold the test set would have to be about 28 scenarios.
- The re-scoring worked as specified: the reviewers recomputed the re-scored losses to five
  decimals and confirmed each model's best epoch was chosen under the new loss. The shuffled
  control's weights are unchanged from phase B because no epoch beat its re-scored loss, which is
  the right outcome for a control.
- Classical's non-converged scenarios (1.4%) are scored as infinite error and included; its
  0.60 kt is not flattered.

Nineteen minor findings were answered or fixed in two rounds, mostly record-keeping: the
manifests of the committed 2b models do not say they are continuations (the facts are in the
review), gate-deciding seeds are now reserved in the plan checker, and the write-up wording above
follows the geometry reviewer's corrections.

Record:
[`review.md`](https://github.com/debrief/Gitma/blob/main/experiments/20261015-i2c-g2/review.md).

## Next

SRD §7 was amended on 2026-10-15 to allow one further round, iteration 2c, and then stop. The
capacity scan (research R20) showed that a two-layer 128-unit LSTM reaches the 96-unit model's
plateau in half the epochs. Iteration 2c trains that model from scratch with the speed weight, on
yet another fresh test split (seed 203). The decision record, with the forecast (1.4–1.6 kt) and
the stopping rule, is committed before training:
[`experiments/20261015-i2d-decision/`](https://github.com/debrief/Gitma/tree/main/experiments/20261015-i2d-decision).
