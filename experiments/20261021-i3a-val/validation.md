# Iteration 3 on validation (spec 007 T010–T011)

Runs 39024150564, 39477106639 and 39604573996 (`train/i3a`, plan `configs/iter3/a`, commit e3a8522):
the 2c models from scratch on generator 0.3.0's three-leg problem (second zig, both turns across the
line of sight; decision 22, `../20261017-i3-decision/`). Seed 204's validation split, with the 2c
models scored beside on the same rows (`--compare-models experiments/20261016-i2d-g2/models`, each
on inputs built with its own normalisation). **The test split (seed 204) has not been scored.**

## Validation rule (FR-006): stop

σ = 1°, zig + 600 s, n = 3,165 (64% of the slice reach zig + 600 s); 95% bootstrap intervals,
2,000 resamples, seed 20261011.

| Condition | Required | Result | |
| --- | --- | --- | --- |
| 2. Operative: LSTM G2 speed interval | lower bound < 1 kt | 1.10 kt [1.06, 1.16] | **fails** |
| 3. Sanity (weak): LSTM / 2c LSTM, paired median speed ratio | interval wholly < 1 | 0.55 [0.52, 0.59] | holds |
| Reported: LSTM / classical, paired median speed ratio | — | 3.29 [3.11, 3.54] | |
| Reported: BiLSTM G2 speed interval | — | 1.02 kt [0.98, 1.05] | inconclusive |
| Reported: BiLSTM / 2c BiLSTM | — | 0.53 [0.50, 0.56] | |
| Reported: BiLSTM / classical | — | 3.03 [2.85, 3.21] | |

Condition 2 fails, so under FR-006 the carried pair does not go to the test split. Iteration 3
stops at validation. Seed 204 stays reserved; its test split is unseen.

## Iteration 3 against 2c on the same rows (σ = 1°)

| Check | 2c models | Iteration 3 | Classical |
| --- | --- | --- | --- |
| instantaneous range, zig + 300 s (< 20%) | 11.4% | **8.8% [8.5, 9.1]** pass | 3.4% |
| instantaneous course, zig + 300 s (< 10°) | 6.53° | **6.19° [5.89, 6.41]** pass | 1.43° |
| instantaneous speed, zig + 600 s (< 1 kt) | 2.01 kt | **1.10 kt [1.06, 1.16]** fail | 0.34 kt |
| time-late range, zig + 300 s | 17.7% | **7.2% [7.0, 7.5]** pass | 3.4% |
| time-late course, zig + 300 s | 7.72° | **4.36° [4.18, 4.54]** pass | 1.43° |
| time-late speed, zig + 600 s | 1.93 kt | **1.02 kt [0.98, 1.05]** inconclusive | 0.34 kt |
| g1 (model / naive range) | | pass: 0.236 / 0.195 | |
| time-late-not-worse | | pass, 19/19 points | |

Naive: 40.2% / 89.7° / 4.23 kt. Controls beaten (CNN 25.2%, MLP 25.4%); shuffled labels 0.994 ×
naive. n = 4,883 at zig + 300 s. 2c on its own seed-203 test split was 1.47 / 1.53 kt; here it is
out of distribution (the forecast's scratch check gave 1.93 kt for its LSTM).

Training:

| Model | Params | Epochs (best) | s / epoch † | Wall | Stop |
| --- | --- | --- | --- | --- | --- |
| lstm-instantaneous (2 × 128) | 203,268 | 50 (43), val 0.275 | 914 | 12.7 h | patience |
| bilstm-time-late (2 × 128) | 537,604 | 73 (66), val 0.167 | 1,744 | 35.3 h, seven chained jobs over three runs | patience |
| cnn-causal-control | 132,932 | 32 (25) | 244 | 2.2 h | patience |
| mlp-control | 927,168 | 39 (32) | 18 | 0.2 h | patience |
| lstm-instantaneous-shuffled (2 × 128) | 203,268 | 9 (2) | 938 | 2.3 h | patience |

† mean increment after epoch 0, (last − first) / (n − 1).

## Reading

- **The forecast held.** Recorded before training: 1.1–1.3 kt, probably above 1 kt. The LSTM
  reached 1.10 kt.
- **The easier problem lifted every estimator.** Classical speed fell to 0.34 kt (R2 forecast
  0.36). Against the 2c models on the same rows, speed improved by 45–47%, range by 23–59% and
  course by 5–44%.
- **The gap to classical widened.** On speed the LSTM is 3.3 × classical, against 2.4 × in 2c; on
  range 2.6 ×, on course 4.3 ×. The extra information went mostly to the estimator that already
  uses it well. This is R1's reading again: geometry lifts both, but the models extract less than
  the bearings carry (Annex A B.1).
- **The BiLSTM is the closest any model has come.** 1.02 kt [0.98, 1.05], an interval straddling
  1 kt; better than the LSTM on every measure this time. It is reported, not gated: FR-006 is on
  the LSTM, and the pair moves together. It needed 35 runner-hours and three dispatches.
- **No condition was changed after the result.** The rule, its reference and the carried set were
  committed in the decision record before training.

## Next

Under Annex A B.3 the next lever is the owner's choice, pre-registered with a fresh seed (205
onward). The result points away from further changes to the problem and towards the models: output
parameterisation, derived features, training changes or capacity (B.2.2–B.2.5).
