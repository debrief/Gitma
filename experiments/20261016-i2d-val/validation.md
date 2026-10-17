# Iteration 2c on validation (spec 005 T005)

Runs 38720086506 and 38849609775 (`train/i2d`, plan `configs/iter2/d`, commit 49d786e): both levers
that moved speed on validation, combined and trained from scratch (decisions 18–20,
`../20261015-i2d-decision/`): 2 × 128-unit stacked recurrent layers for the instantaneous LSTM, the
time-late BiLSTM and the shuffled control, `loss_weight_speed` 4, `max_epochs` 150, patience 6.
Validation only; the fresh test split (seed 203) has not been scored.

## 2c against 2b (σ = 1°, 95% bootstrap intervals)

| Check | 2b | 2c |
| --- | --- | --- |
| instantaneous range, zig + 300 s (< 20%) | 15.2% [14.8, 15.6] pass | **13.0% [12.6, 13.5]** pass |
| instantaneous course, zig + 300 s (< 10°) | 8.47° [8.15, 8.88] pass | **7.25° [6.97, 7.61]** pass |
| instantaneous speed, zig + 600 s (< 1 kt) | 1.77 kt [1.67, 1.83] fail | **1.42 kt [1.35, 1.47]** fail |
| time-late range, zig + 300 s | 15.5% [15.0, 16.1] pass | **12.2% [11.8, 12.6]** pass |
| time-late course, zig + 300 s | 8.56° [8.22, 8.94] pass | **6.38° [6.13, 6.66]** pass |
| time-late speed, zig + 600 s | 1.76 kt [1.70, 1.84] fail | **1.52 kt [1.45, 1.58]** fail |
| g1-instantaneous (model / naive) | pass | pass: 0.369 [0.358, 0.381] |
| g1-time-late (model / naive) | pass | pass: 0.336 [0.324, 0.346] |
| time-late-not-worse | 2/19 points worse | 4/19 points worse (t = 960–1140 s) |

Classical on the same rows: 8.2% / 3.38° / 0.60 kt [0.56, 0.64]. Controls beaten (CNN 28.4%, MLP
27.6%); shuffled labels 1.010 × naive. n = 4,690 at zig + 300 s, 3,014 at zig + 600 s.

Training:

| Model | Params | Epochs (best) | s / epoch † | Wall | Stop |
| --- | --- | --- | --- | --- | --- |
| lstm-instantaneous (2 × 128) | 203,268 | 82 (75), val 0.412 | 554 | 12.6 h | patience |
| bilstm-time-late (2 × 128) | 537,604 | 74 (67), val 0.326 | 1,338 | 27.5 h, five chained jobs over two runs | patience |
| cnn-causal-control | 132,932 | 33 (26) | 231 | 2.1 h | patience |
| mlp-control | 927,168 | 40 (33) | 10 | 0.1 h | patience |
| lstm-instantaneous-shuffled (2 × 128) | 203,268 | 8 (1) | 904 | 2.0 h | patience |

† mean increment after epoch 0, (last − first) / (n − 1), as `tma-scan` reports it.

Validation losses under the same loss (speed weight 4): 2b LSTM 0.462 at epoch 104, 2c LSTM 0.412
at epoch 75; 2b BiLSTM 0.515 at epoch 134, 2c BiLSTM 0.326 at epoch 67.

## Reading

- Capacity on top of the speed-weighted loss moved every check again: speed 1.77 → 1.42 kt
  (instantaneous, −20%) and 1.76 → 1.52 kt (time-late, −14%); range and course improved by
  15–25%. The result sits inside the forecast recorded before the run (1.4–1.6 kt).
- Speed still fails, with the whole interval above 1.35 kt; the models are 2.4–2.5 × classical,
  which is at the Cramér–Rao bound (0.60 kt).
- For the first time the time-late model is clearly *better* than the instantaneous one on range
  and course (12.2% vs 13.0%, 6.4° vs 7.2°) but worse on speed (1.52 vs 1.42 kt). The
  `time-late-not-worse` check fails at four late points (960–1140 s): the deficit is late, largest
  at σ = 2°, and worst near the window end where the backward pass has little context (the check
  carries no interval; the G2 panel's paired intervals contain the slack).
- Per-epoch cost rose 1.4× (LSTM) and 2.2× (BiLSTM) against 2b; the BiLSTM needed five chained
  jobs over two runs (27.5 runner-hours).

## Next (spec 005 T006)

The carried set is pre-declared (the 2c models, unconditionally); the fresh test split (seed 203) is
scored once for them, with the 2b models beside as the other phase. SRD §7 (amended 2026-10-15)
allows no further iteration under G2.
