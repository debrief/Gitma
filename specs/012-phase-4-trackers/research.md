# Research: Phase 4 — end-to-end learned trackers

Decision record: `experiments/20261030-p4-decision/` (decision 29). Data: seed 211 (generator
0.5.0, 100,000 scenarios, `configs/phase4/a/plan.json` digests); every figure here is on its
validation split, 4,951 scenarios, 16,500 G5 rows (σ = 1°, zig + 5/10/15/20 min).

## R1 Training cost

Measured on 4 idle cores, batch 256, full 360-row windows (no bucketing):

| Model | s per batch | h per 80,000-window epoch |
| --- | --- | --- |
| T1 learned-gain filter (64-unit GRU) | 5.2 | ≈ 0.5 |
| T2 2 × 128 LSTM, Gaussian head | 11.4 | ≈ 1.0 |

- **Effect of bucketing.** Length bucketing shortens both, because windows run 20–60 min, so 120–360 rows.
- **Jobs needed.** At patience 6 and 20–40 epochs, T2 needs about 20–40 h. That is more than three
  chained 345-min jobs, so `train.yml` will be re-dispatched; it resumes from the checkpoint.
- **The filter layer.** Its unrolled step is cheaper than the LSTM's, but is not fused. Its cost is
  dominated by the 360 sequential steps, not the GRU's width.

## R2 Reference tuning

- **Objective.** The median range error over G5 rows, as Annex C §C.5 gates it.
- **Two declared grids.**
  - `configs/phase4/tracker-grid.json`
  - `configs/phase4/tracker-grid-ext.json`, declared after the first grid's best IMM sat on its
    r_scale and p0_scale upper edges.
- **Method.** Stage 1 scored 300 scenarios; stage 2 re-scored the top 10 on all rows.
- **Script.** `scripts/research/spec012-tune.mjs`.
- **Outputs.** `experiments/20261030-p4-research/tune.json` and `tune-ext.json`.

| Estimator | Median range, all rows | P90 | Settled | zig + 5 / 10 / 15 / 20 min | Not converged |
| --- | --- | --- | --- | --- | --- |
| **IMM** cv 0.01, ct 0.03, ω 0.01, switch 0.001, P0 × 4, R × 8 (frozen) | **9.24%** | 39.0% | 7.21% | 5.5 / 9.2 / 13.0 / 16.6% | 0.22% |
| EKF σ_a 0.03, P0 × 4, R × 8 | 9.72% | 41.1% | 7.11% | 5.6 / 9.4 / 14.0 / 17.8% | 0.10% |
| First grid's IMM (cv 0, R × 4) | 9.39% | 39.7% | 7.38% | | 0.62% |
| Batch least squares | 12.2% | 88.8% | 6.66% | 5.3 / 12.2 / 23.8 / 34.8% | 4.7% |

**Findings.**
- **R inflation is central.** R × 8 beats R × 4 (9.24% against 9.45% at the same P0) and R × 16.
  The optimum is inside the union of the two grids in both R and P0.
- **The surface is flat in σ_cv and σ_ct.** The top four IMMs lie within 0.05 points. σ_ct = 0.03
  is the lowest value tried, but 0.1 costs only 0.04 points, so the edge is immaterial.
- **The IMM beats the EKF overall,** and wins most at later gate times, where more manoeuvres have
  happened. The EKF is reported.
- **Least squares wins on settled rows** (6.7%), because a batch solution over a long straight
  segment beats a recursive filter there. It loses badly after manoeuvres, so it is no candidate
  reference for the overall checks. It is reported beside the gate.

## R3 Data distribution

From `scripts/research/spec012-distribution.mjs` (`experiments/20261030-g0-p4-r3/distribution.json`):
- **Settled rows** are about 44% of G5 rows.
- **The settled share at zig + 5 min** is mostly rows before the first manoeuvre.
- **The manoeuvre count correlates with window length.** Later gate times therefore over-weight
  busy scenarios. That is the intended estimand, and it is also the reference's tuning objective.
- **Single source for settled rows.** The script imports `settledRow` from `@tma/eval`, so G0's
  distribution figures and `tma-g5` share one definition.
