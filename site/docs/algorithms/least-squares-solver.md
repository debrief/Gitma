# Least-squares bearings-only solver

Source: `packages/classical/src/lsq.ts`, `estimate.ts`. Requirements: SRD §5 (classical baseline),
spec 001 FR-014, research R5.

## Model

Target state at window start `θ = (x₀, y₀, vₓ, v_y)`; the target moves at constant velocity:
`q(t) = (x₀ + vₓ t, y₀ + v_y t)`. With ownship at `p(tᵢ)`, the predicted bearing is

`hᵢ(θ) = atan2(q_x(tᵢ) − p_x(tᵢ), q_y(tᵢ) − p_y(tᵢ))`.

## Cost

`C(θ) = Σᵢ rᵢ²`, `rᵢ = wrap(zᵢ − hᵢ(θ))` over valid bearings, where `wrap` maps to (−π, π].

## Jacobian

With `dx = q_x − p_x`, `dy = q_y − p_y`, `ρ² = dx² + dy²`:

`∂h/∂x₀ = dy/ρ²`, `∂h/∂y₀ = −dx/ρ²`, `∂h/∂vₓ = t·dy/ρ²`, `∂h/∂v_y = −t·dx/ρ²`.

## Iteration (Levenberg–Marquardt)

Solve `(JᵀJ + λ·diag(JᵀJ)) δ = Jᵀr` and accept `θ + δ` if the cost does not increase (then λ ÷ 10),
otherwise λ × 10 and retry. Converged when an accepted step changes the cost by ≤ 10⁻¹² relative, or
no damping up to λ = 10¹² reduces it (a stationary point). Maximum 50 iterations; reaching it is
reported as `converged = false`.

## Start

Grid of 12 log-spaced ranges (1–40 km) along the first valid bearing × 8 courses × 3 speeds
(2, 5, 9 m/s); the lowest-cost grid point seeds LM.

## Modes

- **final**: all bearings, estimate at the last sample.
- **per-timestep**: for each sample from `zig_index + 1` (the first ownship position off the leg-1
  line, so range is observable), bearings up to and including that sample only; warm-started from
  the previous sample's solution.

## Verification

On noise-free data (σ = 0) the solver recovers truth to ≈ 10⁻⁶ relative range (G0 check 1), well
inside the 0.1% tolerance. Immediately after the zig, per-timestep estimates can exceed that
tolerance (worst seen 0.4%): with one or two leg-2 bearings the geometry is barely observable, and
float32 bearing rounding (≈ 5 × 10⁻⁷ rad) then dominates. G0 therefore uses the final-mode estimate.
