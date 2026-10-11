# Scenario generator

Source: `packages/sim/src/scenario.ts`. Requirements: SRD §2–3, spec 001 FR-001–FR-009.

## Frame and units

Local flat-earth Cartesian: x east, y north, metres, origin at ownship's position at window start.
Bearings and courses are true, clockwise from north, radians in [0, 2π). Speeds in m/s; times in
seconds since window start. Every stored value is rounded to float32 (negative zero stored as +0).

## Random numbers

Each scenario has its own seed, `seed_i = SplitMix64(dataset_seed)` output number `i`. The scenario's
stream is xoshiro128\*\* seeded from two SplitMix64 outputs of `seed_i`. Uniform doubles use 53 bits
from two 32-bit outputs; Gaussian draws use Box–Muller (one variate per draw).

## Draw order

For each attempt: sample count `S` (uniform integer, window/dt), ownship speed, ownship course `c₀`,
|zig angle|, zig sign (±), zig fraction `f`, initial range `r₀` (log-uniform by default), initial
bearing `β₀`, target speed `v_t`, target course `θ_t`, noise σ (uniform choice from a set), dropout
fraction `d`. All parameters are float32-rounded before use, so the metadata describes the data
exactly.

## Motion

Zig index `k = round(f · S)`, zig time `t_z = k · dt`, leg-2 course `c₁ = c₀ + zig`.

Ownship at sample `i` (time `t = i · dt`), speed `v`:

- `i < k`: `p(t) = v t (sin c₀, cos c₀)`
- `i ≥ k`: `p(t) = v t_z (sin c₀, cos c₀) + v (t − t_z)(sin c₁, cos c₁)`

Target: `q(t) = r₀ (sin β₀, cos β₀) + v_t t (sin θ_t, cos θ_t)`.

If the range `|q − p|` falls below `min_range_m` (100 m) at any sample, the parameters are redrawn
from the same stream; the redraw count is recorded in the dataset header.

## Observations

For each sample: `ε ~ N(0, σ²)` and `u ~ U[0, 1)` are drawn (always both, so the stream does not
depend on outcomes). The bearing is `wrap(atan2(q_x − p_x, q_y − p_y) + ε)`. If `u < d` the sample is
a dropout: `valid = false`, bearing stored as 0.

## Checks

Hand-computed known answers (`packages/sim/test/unit/known-answer.test.ts`) check the frame
independently of the classical solver, so a sign or frame error shared by generator and solver
cannot pass unnoticed.
