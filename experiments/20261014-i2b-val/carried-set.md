# Phase B on validation and the carried set (spec 003 T044)

Run 38471997045: phase B continued every model from its phase-A weights (decision 14: 150 epochs,
patience 6). Validation only; the test split had not been scored when this was written.

## Phase B against phase A

σ = 1° slice; 95% bootstrap intervals.

| Check | Phase A | Phase B |
| --- | --- | --- |
| instantaneous range, zig+300 s (< 20%) | 17.4% [16.8, 18.0] pass | **16.6% [16.2, 17.2] pass** |
| instantaneous course, zig+300 s (< 10°) | 10.47° [9.93, 11.08] fail | 9.56° [9.02, 10.05] inconclusive |
| instantaneous speed, zig+600 s (< 1 kt) | 2.24 kt [2.14, 2.32] fail | 2.12 kt [2.04, 2.21] fail |
| time-late range, zig+300 s | 20.0% [19.4, 20.7] fail | 18.7% [17.9, 19.3] pass |
| time-late course, zig+300 s | 11.20° [10.71, 11.64] fail | 10.57° [10.17, 11.06] fail |
| time-late speed, zig+600 s | 2.64 kt [2.54, 2.74] fail | 2.34 kt [2.24, 2.44] fail |

Training:

| Model | Phase A | Phase B |
| --- | --- | --- |
| lstm-instantaneous | best epoch 59, val 0.360 | best epoch 67, val 0.346; patience stop at 74 |
| bilstm-time-late | best epoch 41, val 0.492 | best epoch 60, val 0.428; patience stop at 67 |

The controls and the shuffled-label check behave as in phase A.

## Carried set (rule pre-declared in `../20261013-i2a-val/decision.md`)

The rule compares the lstm-instantaneous range median: phase B 0.1664, phase A 0.1740. B is
better, so it is well within phase A's interval half-width (0.0061). **Phase B is carried.**

The test split is then scored once, for phase B, with phase A reported beside it:
`tma-g2 --split test --decision ../20261013-i2a-val/decision.json --compare-models <phase-A models>`.

The longer training budget helped course and range. It does not close the speed gap: speed is
about 2.1–2.3 kt against a 1 kt threshold, and classical reaches 0.60 kt on the same rows.
