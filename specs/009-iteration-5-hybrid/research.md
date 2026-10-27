# Research: Iteration 5 — the route to G3

All on seed 205's validation split (σ = 1° slice), with the frozen iteration-4 models. The split
decides nothing; seed 205's and 206's test splits are not read.

## R1 — The per-leg steady-track fit (B.2.3) (2026-10-27)

**Question.** The fit was proposed in spec 003 R18. Can a range-free fit within each ownship leg
give the network the second-order quantity it does not extract: the range-rate ratio ṙ/r?

**Method.**
- **The fit.** Within each ownship leg, up to row t, a homogeneous least-squares fit of the
  straight relative track p(τ) = p₀ + wτ to the bearings: the smallest eigenvector of AᵀA, with
  one row per bearing, p_x cos b − p_y sin b = 0.
- **What it gives.** The fitted bearing rate and ṙ/r at t; range cancels.
- **Code.** `scripts/research/spec009-legfit.mjs` and `spec009-r1-legfit-accuracy.mjs`.

**Findings** (4,938 scenarios):

| Point | Leg age (median) | ḃ error, leg fit | ḃ error, 3-min trailing rate | ṙ/r: true / error |
| --- | --- | --- | --- | --- |
| end of leg 1 | 810 s | 0.20 °/min | 0.27 °/min | 2.1 / 0.59 per h |
| zig + 300 s (leg 2) | 290 s | 1.48 | 0.57 | 1.1 / 64 per h |
| zig + 600 s (leg 3) | 260 s | 1.07 | 0.23 | 1.1 / 37 per h |

**Reading.**
- **A long leg gives a usable ṙ/r** (about 28% error).
- **The gate points fall on young legs.** There even an ideal fit gives about ±9 /h against a
  true value near 1 /h: ṙ/r = −b̈/(2ḃ), and b̈ over 260 s at 1° noise is poorly determined.
- **Why classical does better.** It fits all legs jointly under a constant target velocity,
  which a range-free per-leg front end gives up.
- **Forecast for this lever:** 0.85–0.92 kt, nowhere near G3's 1.2 × classical. Set aside
  (decision 24).

## R2 — A network-initialised solver (B.2.6) (2026-10-27)

**Question.** Does starting the least-squares solver from the network's estimate, instead of
the coarse grid, cut classical's gross errors?

**Method** (1,501 scenarios, 107,764 per-timestep rows). At each row:
- Levenberg–Marquardt runs from the iteration-4 LSTM's estimate and from the previous solution;
  the lower-cost usable result is kept.
- The grid is used only if neither converges to a plausible state.
- **Code:** `scripts/research/spec009-r2-hybrid-validation.mjs`.

**Findings.**
- **It changes almost nothing.** It differs from classical in 135 rows (0.13%). Medians,
  P90s and gross-error rates are identical at every gate point.
- **Classical's gross errors are not missed basins.** In 2,379 rows classical is grossly
  wrong (range error > 50% or no converged estimate). In all but one, the true state has a higher
  cost than classical's solution: the least-squares optimum itself is far from the truth (a
  near-unobservable geometry), and any start converges to it.
- **The LSTM is still right there.** In 2,165 of those 2,379 rows (91%), the LSTM's range was
  within 50% of the truth.

**Reading.** To use the network, the estimator must sometimes *not* take the least-squares
optimum. That leads to R3.

## R3 — The disagreement switch: validation diagnostic (Annex A B.3.3) (2026-10-27)

**Rule** (`hybridSwitch`): classical's row, unless classical did not converge or the two ranges
differ by more than 50% of the network's; then the network's row. The threshold is the gross-error
bound, not tuned.

**Run.**
- **Pipeline.** `tma-solve --per-timestep`, then `tma-model-predict` (the LSTM, with its own
  normalisation), then `tma-hybrid`, then `tma-g3`, on the whole validation split: 10,000
  scenarios, 710,025 rows.
- **Switching.** 4.5% of rows across all noise levels; 1.5% at zig + 300 s on the σ = 1° slice.

| σ = 1° check (paired bootstrap, 2,000 resamples) | Hybrid / classical, or difference | 95% CI | |
| --- | --- | --- | --- |
| range median, zig + 300 s | 1.001 | [0.994, 1.009] | pass |
| range P90, zig + 300 s | 0.987 | [0.960, 1.001] | pass |
| course median, zig + 300 s | 1.025 | [1.003, 1.035] | pass |
| course P90, zig + 300 s | 0.956 | [0.914, 0.988] | pass |
| speed median, zig + 600 s | 1.015 | [1.002, 1.033] | pass |
| speed P90, zig + 600 s | 1.013 | [1.000, 1.035] | pass |
| gross-error rate, zig + 300 s | 0.553% vs 1.249%: −0.696 pp | [−1.003, −0.410] pp | pass |

n = 4,883 at zig + 300 s and 3,147 at zig + 600 s.

**Rule FR-006 holds.** Every ratio passes, and the gross-error interval lies wholly below 0.

**Other figures.**
- At zig + 600 s, gross errors are 0.16% for classical and 0.10% for the hybrid: too few to test
  at this n. That is why the gate's gross check is at zig + 300 s.
- The LSTM alone is at 0.96% at zig + 300 s.

**Caveat.** This split informed the choice of rule (R2 and R3), so it is not independent
evidence. The gate is fresh seed 207.
