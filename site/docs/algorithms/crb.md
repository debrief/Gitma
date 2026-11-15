# Cramér–Rao bound under correlated bearing error

Source: `scripts/research/spec024-crb.mjs`. Requirements: spec 024 (the information-limit check).
Results: `experiments/20261115-crb/results.md`.

## What it bounds

The Cramér–Rao bound (CRB) is the smallest error covariance any unbiased estimator can reach from
the given bearings, under a known error model. Spec 024 compares every estimator with it at the G5
rows. The bound is evaluated at the true target track, so it varies with the geometry.

## Model

- **Unknowns.** Offsets to the true target track: `θ = (δx, δy, δvₓ, δv_y)`, referred to t = 0,
  with `q(t) = q_true(t) + δp + δv·t`. Ownship is known exactly.
- **Bearings.** `bᵢ = atan2(q_x(tᵢ) − p_x(tᵢ), q_y(tᵢ) − p_y(tᵢ)) + eᵢ`, using only samples
  that were not dropped.
- **Error.** `e ~ N(0, Σ)`, with Σ exactly as the generator draws it (generator 0.6.0):

  `Σᵢⱼ = σ²·δᵢⱼ + s_ar²·exp(−|tᵢ − tⱼ|/τ_ar) + s_b²·exp(−|tᵢ − tⱼ|/τ_b)`

  - the phase-7 values are `s_ar` 1.0°, `τ_ar` 30 s, `s_b` 0.5° and `τ_b` 1,200 s;
  - the clean twin keeps only `σ²·δᵢⱼ`.
- **Constant-velocity target.** On rows before any target manoeuvre the target has held constant
  velocity, and this is the exact model.
- **After a manoeuvre.** The same offsets assume the estimator knows the manoeuvre's shape. That
  makes it a **genie bound**, lower than the true one.

## Computation

1. Each row of `H` is the bearing's gradient with respect to `θ`:
   `(gₓ, g_y, gₓ·tᵢ, g_y·tᵢ)`, with `gₓ = Δy/r²` and `g_y = −Δx/r²`.
2. Factor Σ = LLᵀ by Cholesky over the valid samples, then form `W = L⁻¹H`. Because L is lower
   triangular, the first rows of W depend only on the first samples. So one factorisation per
   scenario gives the Fisher information `J_k = Σ_{i ≤ k} wᵢwᵢᵀ` for every row k.
3. Invert to get `CRB₀ = J_k⁻¹`, then carry it to time k with `T = [[I, t_k·I], [0, I]]`:
   `C_k = T·CRB₀·Tᵀ`.
4. Apply the delta method:
   - **Range:** gradient `(Δx, Δy, 0, 0)/r`, reported relative to r;
   - **Course:** gradient `(0, 0, v_y, −vₓ)/|v|²`;
   - **Speed:** gradient `(0, 0, vₓ, v_y)/|v|`.

## Summary statistic

On a slice of rows, the bound's **median absolute error** is the median of `|e|` when e is zero-mean
Gaussian with each row's bound sd, each row equally likely. It is found by bisection on
`mean erf(m / (sdᵢ√2)) = 0.5`. It is then compared with each estimator's median error on the same
rows.

## Checks and limits

- **Check.** On straight-leg rows, batch least squares matches the bound within 3% on range,
  course and speed, with white noise and with realistic error.
- **Unbiased estimators only.** The bound covers unbiased estimators. A learned model carries a
  prior from training and could beat it where the bearings carry little information.
- **Known error statistics.** The bound assumes the estimator knows the error model. Estimators
  that assume white noise can only do worse.
