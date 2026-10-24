# Iteration 4 on validation (spec 008 T008–T009)

Runs 39827501938 and 39948611113 (`train/i4a`, plan `configs/iter4/a`, commit d124f3c): velocity
outputs and the derived feature set on iteration 3's three-leg problem (decision 23,
`../20261022-i4-decision/`). Seed 205's validation split, with the iteration-3 models scored beside
on the same rows (`--compare-models experiments/20261021-i3a-val/models`, each on raw inputs built
with its own normalisation). A local run on the same weights and data gave identical figures.

## Validation rule (FR-006): carry to test

σ = 1°, zig + 600 s, n = 3,147 (64% of the slice reach zig + 600 s); 95% bootstrap intervals,
2,000 resamples, seed 20261011.

| Condition | Required | Result | |
| --- | --- | --- | --- |
| 1. Operative: LSTM G2 speed interval | lower bound < 1 kt | 0.94 kt [0.91, 0.98] | **holds** |
| 2. Speed moved: LSTM / iteration-3 LSTM, paired median speed ratio | interval wholly < 1 | 0.81 [0.77, 0.87] | **holds** |
| Reported: LSTM / classical, paired median speed ratio | — | 3.03 [2.82, 3.27] | |
| Reported: BiLSTM G2 speed interval | — | 0.77 kt [0.72, 0.80] | |
| Reported: BiLSTM / iteration-3 BiLSTM | — | 0.79 [0.74, 0.84] | |
| Reported: BiLSTM / classical | — | 2.47 [2.28, 2.66] | |

Both conditions hold, so the carried pair goes to seed 205's test split, scored once with the
iteration-3 models beside (`../20261024-i4-g2/`).

## Iteration 4 against iteration 3 on the same rows (σ = 1°)

| Check | Iteration 3 | Iteration 4 | Classical |
| --- | --- | --- | --- |
| instantaneous range, zig + 300 s (< 20%) | 8.8% | **7.1% [6.9, 7.4]** pass | 3.3% |
| instantaneous course, zig + 300 s (< 10°) | 6.22° | **4.72° [4.52, 4.89]** pass | 1.39° |
| instantaneous speed, zig + 600 s (< 1 kt) | 1.16 kt | **0.94 kt [0.91, 0.98]** pass | 0.31 kt |
| time-late range, zig + 300 s | 7.3% | **5.3% [5.1, 5.4]** pass | 3.3% |
| time-late course, zig + 300 s | 4.37° | **3.14° [3.02, 3.28]** pass | 1.39° |
| time-late speed, zig + 600 s | 0.97 kt | **0.77 kt [0.72, 0.80]** pass | 0.31 kt |
| g1 (model / naive range) | | pass: 0.207 / 0.152 | |
| time-late-not-worse | | pass, 18/18 points | |

Naive: 39.9% / 88.5° / 4.27 kt. Controls beaten (CNN 15.5%, MLP 13.4%); shuffled labels 0.985 ×
naive. n = 4,883 at zig + 300 s.

Training:

| Model | Params | Epochs (best) | s / epoch † | Stop |
| --- | --- | --- | --- | --- |
| lstm-instantaneous (2 × 128) | 204,804 | 35 (28), val 0.168 | 920 | patience |
| bilstm-time-late (2 × 128) | 540,676 | 60 (53), val 0.086 | 1,119 | patience, four chained jobs over two runs |
| cnn-causal-control | 135,812 | 30 (23) | 133 | patience |
| mlp-control | 1,111,488 | 31 (24) | 12 | patience |
| lstm-instantaneous-shuffled (2 × 128) | 204,804 | 15 (8) | 702 | patience |

† mean increment after epoch 0, (last − first) / (n − 1). Validation losses are on the velocity
loss and do not compare with earlier iterations'.

## Reading

- **The forecast held at its better end.** Recorded before training: 0.90–1.10 kt, central about
  1.0. The LSTM reached 0.94 kt.
- **Every measure moved, on the same problem.** Against the iteration-3 models on the same rows,
  speed improved by 19–21%, range by 19–27% and course by 24–28%. The iteration-3 models are in
  distribution here, so this is a like-for-like comparison.
- **Course did not suffer.** The velocity loss has no course term and weighs course less on slow
  targets (research R2), yet course improved by a quarter.
- **The gap to classical narrowed but remains large:** 3.0 × on speed (3.3 × in iteration 3),
  2.1 × on range, 3.4 × on course.
- **Two levers at once.** The record cannot say whether the velocity outputs or the derived
  features moved speed (research R4).
- **The validation upper bound is close to the threshold.** The LSTM's interval reaches 0.98 kt;
  a test pass needs the whole interval below 1 kt.
