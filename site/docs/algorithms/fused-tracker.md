# Fused tracker (the IMM with a learned range measurement)

Source: `fusedPredict` in `packages/classical/src/fused.ts`, and `immRangeUpdate` in
`packages/classical/src/imm.ts`. CLI: `tma-fuse-track`.

Requirements: SRD Annex C §C.11 (owner decision 31), spec 014.

## Why

The phase-4b tracker hybrid passed G5, but it took T2's range and, on most rows, the IMM's
velocity. That has two costs:
- **Not one track state.** The range and velocity it reports come from different estimators.
- **Worse before a manoeuvre.** There it is 1.47 × the IMM's range error, because it always takes
  T2's range.

The fused tracker keeps one filter and gives it T2's range as information.

## Equations

The frozen reference IMM (CV + coordinated turn on (x, y, vx, vy, ω);
[trackers](trackers.md)) runs unchanged. After each bearing update at sample i, when
(i − (zig_index + 1)) is a multiple of M and T2's row at i is converged, each model takes a
log-range update:

- z = ln r̂, where r̂ is T2's range at sample i;
- h(x) = ln ρ, with ρ² = (x − x_own)² + (y − y_own)²;
- H = [dx/ρ², dy/ρ², 0, 0, 0];
- R = (k · σ̂)², where σ̂ is T2's stated log-range sd (`log_range_sd`);
- K = P Hᵀ / (H P Hᵀ + R) and x ← x + K (z − ln ρ);
- P ← (I − KH) P (I − KH)ᵀ + K R Kᵀ (Joseph form).

The model probabilities are left to the bearings. The combined estimate and the re-initialisation
are the IMM's own (`immPredict`, through its `extra` step hook). The rule is causal: sample i reads
only T2's row at sample i.

## Why k and M

T2's range errors are correlated from one sample to the next, and with the bearings the IMM already
uses. Fusing every sample at T2's stated sd counts the same information many times. Two settings
control this:
- **k** inflates T2's stated sd.
- **M** thins the updates to one every M samples.

Their effect is roughly through u = M · k². On seed-211 validation, every variant with u from 48
to 192 is within 0.02 of the best smallest margin over G5's five checks
(`experiments/20261102-fused-research/`). The frozen choice is k = 4, M = 6 (u = 96, one update a
minute), the middle of that plateau.

## What it claims (validation, in-sample)

| Ratio to the IMM | Overall range | Overall course | Settled range | Settled course | Settled speed | Settled, before any manoeuvre: range |
| --- | --- | --- | --- | --- | --- | --- |
| Fused, k4 M6 | 0.81 | 0.93 | 0.85 | 0.91 | 0.88 | 0.94 |
| Tracker hybrid | 0.85 | 0.90 | 0.97 | 0.98 | 0.99 | 1.35 |

## Limits

- **Uncertainty is not calibrated.** Its stated covariance is too wide on typical rows and too
  narrow when it lags a manoeuvre. The reference IMM's covariance has the same pattern (mean NEES
  50–100, median about 1, where 4 and 3.4 are expected). The fusion does not make it worse, but
  the covariance should not be reported as calibrated.
- **Course after a manoeuvre.** It gives up some overall course accuracy (0.93 × against the
  hybrid's 0.90 ×), and some range accuracy after a manoeuvre.
- **Against the EKF** it is still worse on settled course (about 1.3 ×).
- **It needs T2's stated sd.** A network that states no uncertainty cannot be fused this way.
