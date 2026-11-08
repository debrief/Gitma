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

**Guards (spec 015).** A row adds nothing if any of these holds:
- it is not converged;
- its range is ≤ 0 or not finite, where ln r̂ is undefined;
- its sd is absent, ≤ 0 or not finite, where R would be singular or meaningless.

No row of the phase-4c test split meets these conditions, so the guards leave the committed result
unchanged (spec 015 R4).

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
- **Against the EKF and batch least squares** it is still worse before any target manoeuvre. There
  its course error is 2.2 × the EKF's (4.09° against 1.88°); over all settled rows it is 1.41 ×.
- **It needs T2's stated sd.** A network that states no uncertainty cannot be fused this way.

## Stated uncertainty and its calibration (spec 018, gate G7)

**The stated sds.** With `--report-sd` (name suffix `-sd`), every converged row carries
`log_range_sd`, `course_sd_rad` and `speed_sd_mps`. They come from the combined IMM covariance by
the delta method:
- ∇ln ρ = (dx, dy)/ρ²;
- ∇θ = (vy, −vx)/v²;
- ∇v = (vx, vy)/v.

**They are miscalibrated as stated.** On seed-211 validation, |error|/sd has a median of 0.17–0.47,
against 0.674 for a Gaussian. Typical intervals are far too wide, and the tails are heavy: m90/m50
is 3–6, against 2.44.

**Post-hoc recalibration.** Each tracker's 50% and 90% intervals are ± m_q × sd, with m_q the
q-quantile of |error|/sd on validation, frozen in decision 33.

**Result on seed 215** (`experiments/20261106-p6u-g7/`; inconclusive):

| Coverage, all G5 rows | 50% | 90% |
| --- | --- | --- |
| Log-range | 48.3% (inconclusive at the 48% floor) | 89.8% |
| Course | 50.5% | 90.2% |
| Speed | 49.3% | 89.6% |

- **Widths.** The fused tracker's median 90% width is 0.73 × (log-range), 0.95 × (course) and
  0.89 × (speed) the IMM's.
- **Coverage holds only on the pooled rows.** Log-range 50% coverage is 67% on settled rows
  before any manoeuvre and 38% after one. Course 50% is 76% settled and 30% unsettled.
- **Many intervals carry little information.** 17% of course 90% intervals span the whole circle,
  and 27% of speed 90% intervals reach below 0.

One multiplier per output cannot fix the intervals' shape.

**Result of the one re-score, seed 216** (`experiments/20261106-p6v-g7/`; **pass**, final): on
184,667 G5 rows, log-range 50% coverage is 48.6% [48.3, 48.9], course 50.5% / 90.3%, speed
49.4% / 89.9%. Widths are 0.73 / 0.94 / 0.89 × the IMM's. The regime pattern above repeats
within a point, so the pass shows pooled coverage within tolerance:
- log-range 50% is about 1.5 pp low on both seeds;
- 67% on settled rows before any manoeuvre and 39% after one;
- 17% of course 90% intervals are vacuous.

It does not show calibration. It was the second look (false-pass risk at most about 5% over both),
and it judges these frozen multipliers, not the procedure that fitted them.

