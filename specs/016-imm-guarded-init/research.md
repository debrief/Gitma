# Spec 016 research (validation only, seed 211; report, no gate)

- **Record:** `experiments/20261103-guarded-init-val/`, with `run.sh`, the three `tma-g5` diagnostics
  (`imm/`, `ekf/`, `fused/`), `non-pd-g*.json` and `predictions.sha256`.
- **Data:** seed-211 validation (10,000 scenarios), regenerated from a clean tree at `659f42e`, with
  plan digests checked.
- **Code:** commit `8a548c7`.
- **Trackers:** the frozen IMM and EKF (decision 29) and the frozen fused tracker (decision 31, on
  the frozen T2), each at level 0 (frozen), 1 (`-g1`) and 2 (`-g2`).

## R1 Accuracy: levels 1 and 2 against level 0, over the G5 rows

Ratios of medians are guarded / frozen, with 97.5% scenario-clustered bootstrap intervals (`tma-g5`
as a diagnostic). The gross-error difference is in percentage points. `tma-g5`'s pass/fail labels
do not apply to this comparison and are ignored.

| Tracker | Level | Overall range | Overall course | Overall speed | Settled range | Settled course | Settled speed | Gross (pp) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IMM | g1 | 1.000 [0.998, 1.001] | 1.002 [0.999, 1.004] | 1.000 [0.999, 1.002] | 1.000 [0.997, 1.003] | 1.000 [0.997, 1.000] | 1.001 [1.000, 1.004] | −0.01 [−0.04, 0.02] |
| IMM | g2 | 1.058 [1.039, 1.073] | 1.021 [1.007, 1.041] | 1.055 [1.040, 1.076] | 1.065 [1.038, 1.098] | 1.068 [1.041, 1.096] | 1.064 [1.039, 1.093] | +0.64 [0.40, 0.91] |
| EKF | g1 | 1.000 [0.998, 1.001] | 1.001 [0.999, 1.004] | 1.000 [0.998, 1.002] | 1.001 [1.000, 1.003] | 1.001 [1.000, 1.005] | 1.000 [1.000, 1.000] | +0.03 [−0.01, 0.08] |
| EKF | g2 | 1.052 [1.036, 1.067] | 1.026 [1.010, 1.043] | 1.064 [1.045, 1.085] | 1.054 [1.029, 1.083] | 1.095 [1.061, 1.140] | 1.085 [1.052, 1.120] | +0.79 [0.53, 1.06] |
| Fused | g1 | 1.000 [0.998, 1.002] | 1.000 [1.000, 1.004] | 1.000 [0.997, 1.000] | 0.999 [0.996, 1.000] | 1.000 [1.000, 1.000] | 1.000 [0.995, 1.000] | +0.01 [−0.03, 0.05] |
| Fused | g2 | 1.020 [1.010, 1.030] | 1.014 [1.003, 1.028] | 1.043 [1.029, 1.059] | 1.021 [1.010, 1.042] | 1.051 [1.029, 1.075] | 1.050 [1.024, 1.076] | −0.01 [−0.13, 0.10] |

- **Level 1 is accuracy-neutral** for all three trackers. Every ratio is 1.000 within ±0.3%, and
  every interval is within [0.995, 1.005].
- **Level 2 is worse** on every statistic: 2–9% on range, course and speed. For the IMM and EKF it
  adds 0.6–0.8 points of gross error.
  - The 60-sample window is too short to observe range after a manoeuvre. The re-initialised range
    is then wrong; at seed 214, scenario 360417, it is 680–960 m against a true ~2,000 m (spec
    tests).
  - The frozen re-initialisation either keeps a wrong long fit, or fails and retries 6 samples
    later. Both turn out better on these rows.

## R2 Numerical health: IMM, every step of every validation scenario

From `spec015-imm-covariance.mjs count <split> <level>`:

| Level | Scenarios with a non-PD model covariance after a step | Non-PD steps | Steps | Non-converged rows (of 1,229,706) |
| --- | --- | --- | --- | --- |
| 0 (frozen) | 6 | 21 | 1,214,452 | 16,481 (1.34%) |
| 1 (`-g1`) | **0** | **0** | 1,213,488 | 17,377 (1.41%) |
| 2 (`-g2`) | 12 | 26 | 1,215,818 | 14,959 (1.22%) |

- **Level 1 removes every non-PD covariance.** The cost is 896 more non-converged rows (+0.07% of
  rows): the refused degenerate fits leave rows with no estimate until a later retry succeeds.
- **G5's error rule already counts those rows.** It scores a non-converged row as an infinite
  error, so the cost is inside R1's neutral ratios and gross-error differences.
- **Level 2 does not remove them** (12 scenarios, 26 steps). Its initial covariances are positive
  definite by construction, so they arise later in filtering. A plausible cause, not
  investigated: a short-window P₀ near the conditioning limit, then losing definiteness in the
  Joseph updates.

## Conclusions

1. **Level 1 is the candidate.** It is numerically safe (no non-PD covariance on validation) and
   accuracy-neutral (every ratio 1.000 ± 0.003) for the IMM, the EKF and the fused tracker.
2. **Level 2 is rejected.** It is less accurate, and not numerically safe.
3. **Nothing is re-frozen.** The frozen references stay at level 0. Adopting level 1 for a future
   reference needs a decision record. The equivalence above suggests it would change no committed
   conclusion, but that is a validation result only.
