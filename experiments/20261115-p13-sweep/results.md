# Spec 026: bearing-error severity sweep (results)

**Data.** Seed 217's validation split at four severities of the realistic-error model (Gauss–Markov
1.0°/30 s plus drifting bias 0.5°/20 min, both scaled): ×0 (white noise only), ×0.5, ×1 and ×2.
The geometry and white noise are identical across severities, so each column differs only in
the correlated error. G5's rows (σ = 1°, zig + 5/10/15/20 min): 16,711, of which 4,205 are on
straight legs. Every estimator is frozen. Medians only, with no intervals (spec 026 limits).

**Pre-registration.** Spec 026, `run.sh` and `scripts/research/spec026-sweep.mjs` were committed
in b8cb5e6 before the run. Numbers are in `sweep.json`; per-severity inputs in `baselines-*.json`
and `crb-*.json`; hashes in `inputs.sha256`.

## Range error (median, relative), all G5 rows

| Estimator | ×0 | ×0.5 | ×1 | ×2 |
| --- | --- | --- | --- | --- |
| Fused tracker | 7.7% | 9.4% | 12.9% | 22.7% |
| IMM (`-g1`) | 9.1% | 11.9% | 16.7% | 29.3% |
| EKF | 9.4% | 11.8% | 16.1% | 26.2% |
| T2 | 8.0% | 9.3% | 12.2% | **18.2%** |
| Least squares | 11.8% | 13.8% | 17.3% | 23.8% |
| Composite (W 6, c 8) | 7.9% | 9.6% | 12.5% | 22.0% |
| Naive | 38.7% | 38.7% | 38.7% | 38.7% |
| **Fused / IMM** | **0.844** | **0.793** | **0.777** | **0.774** |
| **T2 / fused** | 1.046 | 0.990 | 0.946 | **0.803** |

Naive ignores bearings, so its constant row confirms the scenarios are the same at every
severity.

## Straight-leg rows (range / course / speed)

| Estimator | ×0 | ×0.5 | ×1 | ×2 |
| --- | --- | --- | --- | --- |
| Bound (exact) | 2.4% / 0.7° / 0.29 kt | 4.0% / 1.2° / 0.49 kt | 6.9% / 2.0° / 0.82 kt | 13.0% / 3.9° / 1.56 kt |
| Least squares | 2.5% / 0.7° / 0.30 kt | 4.0% / 1.2° / 0.49 kt | 6.9% / 2.0° / 0.83 kt | 13.1% / 3.9° / 1.61 kt |
| LSQ / bound, range | 1.03 | 1.00 | 1.01 | 1.01 |
| Composite | 2.5% / 0.7° / 0.30 kt | 3.9% / 1.2° / 0.49 kt | 7.0% / 2.1° / 0.87 kt | **16.7% / 12.5° / 2.89 kt** |
| Fused tracker | 4.2% / 3.9° / 0.67 kt | 5.9% / 5.6° / 0.98 kt | 9.4% / 9.0° / 1.56 kt | 18.2% / 19.7° / 3.36 kt |
| IMM | 4.0% / 3.9° / 0.66 kt | 6.3% / 5.7° / 1.05 kt | 11.5% / 9.8° / 1.78 kt | 22.5% / 21.9° / 3.35 kt |
| T2 | 6.1% / 8.0° / 2.03 kt | 7.5% / 10.2° / 2.18 kt | 10.4% / 15.4° / 2.42 kt | 16.5% / 26.8° / 2.93 kt |

## Settled rows after a manoeuvre (range; ratio to IMM)

| Estimator | ×0 | ×0.5 | ×1 | ×2 |
| --- | --- | --- | --- | --- |
| Fused tracker | 11.1% (0.75) | 12.1% (0.71) | 15.1% (0.73) | 25.8% (0.70) |
| IMM | 14.8% | 17.0% | 20.7% | 36.6% |
| T2 | 10.1% (0.68) | 11.4% (0.67) | 14.2% (0.69) | 20.5% (0.56) |
| Least squares | 33.0% | 33.2% | 34.5% | 37.7% |
| Genie bound | 2.0% | 3.4% | 5.8% | 11.0% |

## Answers to the pre-registered questions

1. **Does the fused tracker's range advantage over the IMM hold, and grow?** It holds at every
   severity: 0.84, 0.79, 0.78, 0.77 × the IMM's range error over all rows. It grows from ×0 to
   ×0.5 and then levels off; it does not keep growing. The growth is on straight legs (1.06 × the
   IMM at ×0, a small loss, then 0.93, 0.82, 0.81). After a manoeuvre it is flat at 0.70–0.75 ×.
2. **Does least squares stay at the bound on straight legs?** Yes. Its median straight-leg range,
   course and speed are within 3% of the exact bound at every severity (range 1.03, 1.00, 1.01,
   1.01 ×). Batch least squares extracts all the information the straight-leg bearings carry,
   even under the doubled error.
3. **When does T2 alone overtake the fused tracker on range?** At ×0 the fused tracker is better
   (T2 1.05 ×). At ×0.5 they tie (0.99 ×, a 1% gap that one seed and no intervals cannot
   separate). From ×1 T2 is better (0.95 ×, as phases 7–11 found), and at ×2 clearly so (0.80 ×,
   and 0.79 × after a manoeuvre). The crossover is between ×0 and ×1, near ×0.5.

## Critical reading

- **The fused tracker carries its IMM's degradation.** Its range is anchored by T2, but its
  dynamics are the white-noise-tuned IMM's. As correlated error grows the IMM falls apart (range
  29% at ×2), and fusion recovers only part of what T2 has. At ×2 the network alone is the better
  range estimator by 20%, and its course (34.9° against 41.7°) and speed (3.3 kt against 4.2 kt)
  are better too. The fusion settings were chosen on white noise (×0, phase 4c); a heavier network weight under heavy error
  is the obvious, untested fix.
- **T2's robustness is partly a prior.** T2 was trained on white noise yet degrades least. Its
  straight-leg range at ×0 is 2.5 × the bound but at ×2 only 1.3 ×: it leans on what it learned
  about typical geometry (spec 024's "slack"), which correlated error cannot corrupt. That is
  useful only while real geometries resemble the generator's. It is not evidence of extra
  information.
- **The composite breaks under heavy error.** Its fit check divides by the white-noise σ alone. At
  ×2 the correlated error trips the check on straight legs, so straight-leg course rises from
  least squares' 3.9° to 12.5°. A threshold tuned at ×1 does not transfer; the check would need
  the error model's full covariance.
- **At ×2 least squares' overall range (23.8%) beats the fused tracker's (22.7%) only narrowly
  and loses after a manoeuvre;** its gain is all on straight legs, as at ×1.
- **Nothing approaches the genie bound after a manoeuvre** (best 1.8–5 × above it), at any
  severity. The open room stays where spec 024 placed it.
- **Limits.** One seed, validation only, no intervals; one error family, scaled; trackers and fusion tuned
  at ×0, so higher severities test robustness, not re-tuned performance. The
  ×1 column reproduces phase 11's validation medians (fused 12.9%, T2 12.2%).

## Consequence for the project's answer

The qualified go survives the sweep: the fused tracker beats its reference IMM on range at every
severity, by about 20%. Two conditions sharpen:

- **Re-tune the fusion to the error level.** From ×1 the stand-alone network beats the fusion,
  so the fixed weights waste the network's advantage.
- **The classical reference must be re-tuned too.** The IMM's collapse at ×2 flatters every
  "better than the IMM" ratio.
