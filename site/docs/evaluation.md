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

1. On a noise-free test split, the classical solver's final-mode estimate is within 0.1% range, 0.1°
   course and 0.01 kt speed of truth on **every** scenario, and converged.
2. Two independently fitted naive baselines give identical metrics.

G0 is necessary, not sufficient: a sign or frame error shared by generator and solver would still
pass check 1, which is why the generator also has hand-computed known-answer tests.
