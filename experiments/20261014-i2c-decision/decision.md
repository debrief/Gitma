# Iteration 2b decision (spec 004)

This record is committed before any 2b weights are trained. `tma-g2` checks that the commit that
added `decision.json` is an ancestor of every carried model's `git_commit`.

## Evidence: G2 failed on speed

[`../20261014-i2-g2/`](../20261014-i2-g2/review.md) was decided by the agent review panel in
round 2, on the σ = 1° slice:

| Estimator | Range, zig + 300 s | Course, zig + 300 s | Speed, zig + 600 s |
| --- | --- | --- | --- |
| lstm-instantaneous (B) | 16.5% pass | 9.46° pass | 2.09 kt [2.00, 2.18] **fail** |
| bilstm-time-late (B) | 18.5% pass | 10.57° fail | 2.38 kt [2.28, 2.48] **fail** |
| classical | 8.8% | 3.42° | 0.62 kt (at the Cramér–Rao bound) |

The panel found three things about speed:
- **Shrinkage to the mean.** Predictions are pulled towards the mean speed (slope about 0.57).
- **A small loss share.** With equal weights, scaled speed is about 15% of the loss: per-row
  terms are log-range 0.103, sin+cos 0.213 and speed 0.056.
- **Early stopping on noise.** Training loss was still falling when patience stopped phase B.

## The single change (user decisions 15–17, 2026-10-14)

- **Loss:** `loss_weight_speed` goes from 1 to 4. Range and course stay at 1.
- **Start point:** every model, controls and shuffled-label model included, continues from its
  committed phase-B weights (`../20261014-i2b-val/models`).
  - The best epoch is re-scored under the new loss.
  - Adam restarts once, with a 3-epoch patience grace.
  - `max_epochs` is 220; patience stays at 6.
- **Unchanged:** data (seed 201), features (raw), architectures, learning rate, batch order and
  seeds. Configs: `configs/iter2/c/`; plan: `configs/iter2/c/plan.json`.
- **Fresh test split:** G2 is judged on the test split of seed 202 (same count and ranges; content
  digest pinned in the plan). It is never judged on the iteration-2 test split, which already
  decided a gate.

What this tests: whether the network can extract the speed information when speed gets a
comparable share of the gradient. What it does not test: richer inputs (derived features, per-leg
fit), or a different stopping rule.

## Carried set (pre-declared)

The 2b models are carried unconditionally. Phase B is scored beside them on the same fresh test
split, as the other phase: reported, never gated.

The test split is scored once:

`tma-g2 --split test --plan configs/iter2/c/plan.json --decision experiments/20261014-i2c-decision/decision.json --compare-models experiments/20261014-i2b-val/models`

If G2 fails again, the project stops at G2 and writes the no-go (SRD §7: "one more iteration
allowed, then stop").
