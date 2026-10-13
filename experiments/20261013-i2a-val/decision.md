# Phase A → phase B decision (spec 003 T043, research R5)

Committed before any phase-B training (SC-005). It uses validation evidence only; the test split
has not been scored.

## Phase A on validation (run 38375014028, code a7a3f33, seed 201)

σ = 1° slice. Range and course are judged at zig + 300 s (n 4,690; 93.0% of the slice reach
it). Speed is judged at zig + 600 s (n 3,014; 59.8% reach it, decision 13). Medians are shown
with 95% bootstrap intervals.

| Estimator | Range (zig+300) | Course (zig+300) | Speed (zig+600) |
| --- | --- | --- | --- |
| G2 threshold | < 20% | < 10° | < 1 kt |
| lstm-instantaneous | **17.4%** [16.8, 18.0] pass | 10.47° [9.93, 11.08] fail | 2.24 kt [2.14, 2.32] fail |
| bilstm-time-late | 20.0% [19.4, 20.7] fail | 11.21° [10.71, 11.64] fail | 2.64 kt [2.54, 2.74] fail |
| classical (per timestep) | 8.2% | 3.4° | 0.60 kt |
| naive | 37.4% | 90.6° | 4.25 kt |

The controls behave as at G1:
- The CNN control is at 0.30 and the MLP control at 0.28 range at zig + 300 s, both worse than
  their recurrent counterparts.
- The shuffled-label model scores exactly naive on range (1.000 ×). On course it reaches 69.5°
  against naive's 91.4°, a stronger bearing-as-course prior than G1's 82.9°. This is reported,
  not gated.

**Stalled:** yes. A gated criterion fails for each variant, so phase B runs (SRD §4, §7).

Training state at the end of phase A:
- **lstm-instantaneous:** reached the 60-epoch cap with validation loss still falling (best
  epoch 59, val 0.360).
- **bilstm-time-late:** stopped on patience 3 at epoch 45 (best 41, val 0.492).
- **Controls:** stopped early.

The models improve little from zig + 300 s to zig + 600 s; the instantaneous range goes from
17.4% to 15.9%. Classical halves its error over the same interval, from 8.2% to 4.5%.

## The single change (user decision 14, 2026-10-13)

**Training budget:**
- `max_epochs` 60 → 150;
- `patience` 3 → 6;
- every model continues from its committed phase-A weights in `models/` (best epoch);
- Adam restarts once, with a 3-epoch patience grace (as in the G1 continuation).

Data, features (raw), architectures, losses, learning rate, batch order and seeds are unchanged.
The configs are in `configs/iter2/b/`; the plan is `configs/iter2/b/plan.json`.

This replaces the pre-registered default change, derived features (R6). The user chose it with
the evidence above. The record states plainly what it tests and what it does not:

- **What it tests:** whether undertraining explains the gap. Only the instantaneous LSTM was
  still improving at its cap; the BiLSTM and controls stopped on patience.
- **What it does not test:** whether the raw inputs limit the models. The flat 300 → 600 s
  curve, against classical's steady improvement, points that way. If phase B still stalls,
  derived features remain the obvious lead for iteration 2b.

## Carried-set rule (pre-declared)

Phase B is carried unless its lstm-instantaneous σ = 1° validation median range error at
zig + 300 s is worse than phase A's by more than phase A's 95% interval half-width (0.006). The
same set, A or B, is carried for both variants and the controls. The test split is then scored
once, for the carried set (`tma-g2 --split test --decision decision.json`), with the other set
reported beside it.
