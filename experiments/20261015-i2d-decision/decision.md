# Iteration 2c decision (spec 005)

Committed before any 2c weights are trained; `tma-g2` checks that the commit adding
`decision.json` is an ancestor of every carried model's training commit. Made after iteration
2b's validation result and **before** 2b's fresh-test scoring; it does not use any test result.

## Evidence

Iteration 2b on validation ([`../20261015-i2c-val/validation.md`](../20261015-i2c-val/validation.md)),
σ = 1°: speed 1.77 kt [1.67, 1.83] instantaneous and 1.76 kt [1.70, 1.84] time-late against 1 kt
(phase B: 2.12 and 2.34 kt); range 15.2% and course 8.47° pass; time-late now matches instantaneous.
Classical 0.60 kt, at the Cramér–Rao bound.

Capacity scan (spec 003 research R20; validation, 30 epochs from scratch, loss weights 1): 96 units
2.90 kt, 192 units 2.25 kt, 2 × 128 units 2.24 kt. The larger models reach the 96-unit model's
60-epoch plateau in half the epochs; 157k and 203k parameters tie.

Each lever moves speed on its own; neither reaches 1 kt on its own.

## The single change (user decisions 18–20, 2026-10-15)

- **SRD §7 amended** to allow one further iteration, 2c, combining the two measured levers; then stop.
- **Model**: 2 × 128-unit stacked recurrent layers, from scratch, for the instantaneous LSTM, the
  time-late BiLSTM and the shuffled-label control; the CNN and MLP controls keep their sizes.
- **Loss**: `loss_weight_speed` 4 (range and course 1), as in 2b.
- **Budget**: `max_epochs` 150, patience 6, one seed per model (1001). The BiLSTM at 2 × 128 runs
  at roughly 1,400 s per epoch, about 40 runner-hours over several chained jobs and pushes.
- **Unchanged**: data (seed 201), features (raw), learning rate, batch order.
- **Fresh test split**: seed 203 (same count and ranges; content digest pinned in
  `configs/iter2/d/plan.json`). Seeds 201 and 202 are never used for this gate.

Forecast, recorded before the run: about 1.4–1.6 kt, probably still above 1 kt. If 2c fails G2 the
project stops at G2 and writes the no-go (SRD §7 as amended).

## Carried set (pre-declared)

The 2c models are carried unconditionally. The 2b models are scored beside them on the seed-203
split as the other phase: reported, never gated. The split is scored once:

`tma-g2 --split test --plan configs/iter2/d/plan.json --decision experiments/20261015-i2d-decision/decision.json --compare-models experiments/20261015-i2c-val/models`
