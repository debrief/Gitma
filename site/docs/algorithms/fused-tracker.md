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
temper this, empirically rather than by modelling the correlation:
- **k** inflates T2's stated sd.
- **M** thins the updates to one every M samples.

On seed-211 validation, 18 variants were scored (`experiments/20261102-fused-research/`). The best
region is k = 4 with M from 1 to 12, together with k = 8, M = 3, at a smallest G5 margin of
0.056–0.075. The frozen choice is k = 4, M = 6 (one update a minute), in the middle of that region.
Thinning and inflating are not interchangeable: no single combination such as M·k² orders the
variants.

## Result: G5 passed on seed 214 (in-sample validation beside it)

| Ratio to the IMM | Overall range | Overall course | Settled range | Settled course | Settled speed | Settled, before any manoeuvre: range |
| --- | --- | --- | --- | --- | --- | --- |
| Fused, test (seed 214) | 0.82 | 0.95 | 0.86 | 0.95 | 0.90 | 1.03 |
| Fused, validation | 0.81 | 0.93 | 0.85 | 0.91 | 0.88 | 0.94 |
| Tracker hybrid, test | 0.86 | 0.91 | 0.99 | 0.98 | 1.00 | 1.43 |

Record: `experiments/20261102-p4f-g5/g5.md`.

## Limits

- **One state, two sources of information.** The fused state is a single IMM state, so its range
  and velocity agree with each other. On test, its implied bearing rate is as accurate as the IMM's.
  But it takes a second estimator's range, and that estimator saw the same bearings; k and M are an
  empirical correction for that, not a model of it.
- **Before any target manoeuvre it only matches the IMM** (range 1.03 × on test, interval
  [0.99, 1.07]). The gains come after manoeuvres.
- **Uncertainty is not calibrated.** Like the reference IMM's, its covariance is too wide on typical
  rows and has an overconfident tail. On test, the median NEES is 1.10 against the IMM's 0.98, where
  3.36 is expected; 94.1% of rows are within the 95% bound, against the IMM's 92.7%. Against the
  nominal bounds it is no worse than the IMM, but the reference's inflation could mask double
  counting.
- **Course.** On overall course it is worse than the phase-4b hybrid: on test, 1.04 × the hybrid,
  interval [1.03, 1.06].
- **Against the EKF and batch least squares**, before any target manoeuvre it is still worse:
  settled course is 1.41 × the EKF's.
- **It needs T2's stated sd.** A network that states no uncertainty cannot be fused this way.
