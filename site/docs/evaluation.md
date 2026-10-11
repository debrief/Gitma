# Evaluation and gates

Source: `packages/eval`. Requirements: SRD §5, spec 001 FR-015–FR-019.

## Errors per estimate

| Metric | Definition |
| --- | --- |
| Range error | `|r̂ − r| / r` (relative) |
| Course error | `|wrap(θ̂ − θ)|` in degrees, wrapped so 359° vs 1° is 2° |
| Speed error | `|v̂ − v|` in knots |
| Position error | `|p̂ − p|` in metres |
| Gross error | range error > 50%, **or** the estimator did not converge |

## Aggregation

Median and 90th percentile (nearest-rank: the value at rank `⌈p·n⌉` of the sorted list), plus
gross-error rate and mean position error. Means are not used for the headline numbers because TMA
failures are heavy-tailed.

## Slices

`overall`; range band by mean range over the window (0–2, 2–5, 5–10, 10–20, 20–30, 30+ km); zig band
by |zig angle| (30–50, 50–70, 70–90°); noise σ.

## Points and curves

- `final`: the estimate at the last sample.
- `zig+300s`: per-timestep estimates five minutes after the zig, the gate point for the
  instantaneous variant. Scenarios whose window ends earlier are excluded and counted.
- Curves: per-timestep medians every 60 s after the zig (`curves.csv`).

`tma-eval` refuses to write a report unless naive and classical predictions for the same test file
are among its inputs, and rejects predictions made from a different truth file (SHA-256 check).

## G0 — pipeline verified

On a noise-free test split (`tma-g0`):

1. **Final-mode recovery**: the classical estimate is within 0.1% range, 0.1° course and 0.01 kt
   speed of truth on **every** scenario, and converged.
2. **Per-timestep recovery** (the G1 baseline path): on 1,000 scenarios every row converges, and
   every row at least 60 s after the zig is within the same tolerances.
3. **Bearing residuals**: every final solution's RMS bearing residual is ≤ 10⁻⁶ rad (float32
   precision), so any mismatch between observations and the constant-velocity fit shows up.
4. **Independent geometry**: hand-computed bearings (before and after the zig, with literal
   `Math.atan2`, not the shared code) and, on every scenario, the t = 0 bearing and range against
   the drawn parameters. This catches frame errors that generator and solver would share.
5. **Naive determinism**: two in-process fits give identical metrics.

Run gates through `pnpm tma-g0` / `pnpm tma-g1`: they rebuild first and refuse a dirty working tree,
and the manifest records the commit, Node version and SHA-256 of every dataset.

### Decision: agent review panel

Gate verdicts are decided by five independent specialist AI reviewers (TMA geometry, estimation and
numerics, evaluation statistics, reproducibility, red team), not by humans. Findings are fixed or
answered, and the panel is re-invited until none rejects and no blocker or major finding is open.
G0 took three rounds; the record is
[`experiments/20261011-g0-r3/review.md`](https://github.com/debrief/Gitma/blob/main/experiments/20261011-g0-r3/review.md).
