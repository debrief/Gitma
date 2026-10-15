# Iteration 2b on validation (spec 004 T007)

Run 38555531269 (`train/i2c`, plan `configs/iter2/c`): every model continued from its committed
phase-B weights with `loss_weight_speed` 4, `max_epochs` 220, patience 6 (decisions 15–16). The
best epoch was re-scored under the new loss before training resumed. Validation only; the fresh
test split (seed 202) has not been scored.

## 2b against phase B (σ = 1°, 95% bootstrap intervals)

| Check | Phase B | 2b |
| --- | --- | --- |
| instantaneous range, zig + 300 s (< 20%) | 16.6% [16.2, 17.2] pass | **15.2% [14.8, 15.6]** pass |
| instantaneous course, zig + 300 s (< 10°) | 9.56° [9.02, 10.05] inconclusive | **8.47° [8.15, 8.88]** pass |
| instantaneous speed, zig + 600 s (< 1 kt) | 2.12 kt [2.04, 2.21] fail | **1.77 kt [1.67, 1.83]** fail |
| time-late range, zig + 300 s | 18.7% [17.9, 19.3] pass | **15.5% [15.0, 16.1]** pass |
| time-late course, zig + 300 s | 10.57° [10.17, 11.06] fail | **8.56° [8.22, 8.94]** pass |
| time-late speed, zig + 600 s | 2.34 kt [2.24, 2.44] fail | **1.76 kt [1.70, 1.84]** fail |
| g1-time-late (model / naive) | fail on the boundary | pass (0.1637 vs limit 0.1919) |
| time-late-not-worse | 14/19 points worse | 2/19 points worse (t = 840, 960 s) |

Classical on the same rows: 8.2% / 3.38° / 0.60 kt. Controls beaten; shuffled labels 1.000 × naive.

Training:

| Model | Phase B best (epochs) | 2b best (epochs) | Stop |
| --- | --- | --- | --- |
| lstm-instantaneous | 67 (74) | 104 (111) | patience |
| bilstm-time-late | 60 (67) | 134 (141), three chained jobs | patience |

## Reading

- Weighting speed 4× cut the speed error by 16–25% (2.12 → 1.77 kt; 2.34 → 1.76 kt) and, with
  the extra epochs, improved range and course as well. Speed still fails, with the whole interval
  above 1.67 kt.
- The time-late model now matches the instantaneous one on every check and passes its G1 ratio
  check cleanly. Its deficit since G1 was a training deficit, not an architectural one.
- Together with the capacity scan (research R20: larger models reach the 96-unit model's
  60-epoch plateau in 30 epochs), the two levers tried so far each move speed but neither reaches
  1 kt. Classical remains at the Cramér–Rao bound (0.60 kt).

## Next (spec 004 US4)

The pre-registered sequence scores the fresh test split once for the 2b models, phase B beside
them. Whether to do that now, or first amend SRD §7 for a 2c that combines the two levers, is a
user decision recorded in spec 004 before any test scoring.
