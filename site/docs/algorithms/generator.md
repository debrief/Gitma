# Scenario generator

Source: `packages/sim/src/scenario.ts` (generator version 0.2.0). Requirements: SRD §2–3, spec 001
FR-001–FR-009, spec 003 FR-001–FR-006 (provenance and the rate-limited turn).

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
fraction `d`, then — only when the ranges give `ownship_turn_rate_rad_s` — the turn rate `ω`
(uniform; iteration 2 uses 0.5–3°/s). Generator 0.3.0 (iteration 3) then draws, only when the
ranges ask for them:

- **Across-the-line-of-sight offset.** The first turn's offset, from `los_offset_rad`, under
  `zig_rule: across_los`.
- **Second zig.** Its delay, from `zig2_delay_s`, then its offset (or, under the random rule, its
  size and side).

Generator 0.4.0 (phase 3, spec 010) then draws, only when the ranges give
`target_manoeuvre_fraction`, four values for every scenario, whether or not its target turns:

- **Whether the target turns.** A uniform draw below the fraction (0.8 in phase 3).
- **Its course change.** Signed, |angle| from `target_manoeuvre_angle_abs_rad` (30–120°).
- **Its turn rate.** From `target_turn_rate_rad_s` (0.5–3°/s).
- **When.** A whole start sample, uniform from `target_manoeuvre_after_zig_s` (2 min) after
  `zig_index` to the last start that ends the turn `target_manoeuvre_margin_s` (6 min) before the
  window ends.

A scenario whose window cannot fit that is redrawn, whether or not its target turns, so turning
and held-course targets share one window distribution. The constraint does shift it: about 0.6
redraws per accepted scenario on the phase-3 ranges (0.21 of them already there before the
target's turn): windows under about 1,100 s all but disappear (P10 1,360 s against 990 s), and
the realised angles and rates lean slightly towards short turns. Phase-3 figures are therefore
not comparable with earlier iterations' without re-running them on phase-3 data.

Generator 0.5.0 (phase 4, spec 012, SRD Annex C §C.2) replaces the single turn when the ranges
give `target_course_change_count_weights` (and then `target_manoeuvre_fraction` must be absent):

- **How many.** The number of course changes (P(0, 1, 2, 3) = 0.2, 0.3, 0.3, 0.2) and whether
  there is a speed change (30%) are drawn **once per scenario**, from their own stream (the
  scenario seed's sub-stream 1), before any geometry. A geometry that cannot fit them is redrawn
  with the same count, so the realised count distribution is the declared one. A first version
  drew the count with the geometry; on 10–40 min windows its redraws left 3.7% of scenarios with
  three turns instead of 20%.
- **What.** For every possible course change, its side, size (30–120°) and rate (0.5–3°/s); for
  the speed change, its side, size (2–6 kt) and rate (0.05–0.2 kt/s). The side is flipped if the
  new speed would leave `target_speed_mps`, and the geometry is redrawn if both sides would. Then
  the speed change's place in the order, and one uniform per possible manoeuvre for the timing.
  All are drawn for every scenario, so the stream is consumed alike whatever is used.
- **When.** Manoeuvres never overlap. The first starts at least 2 min after `zig_index`, each
  starts at least `target_manoeuvre_spacing_s` (3 min) after the previous one ends, and the last
  ends at least 6 min before the window ends. The free time is shared out by sorted uniforms.

Phase-4 windows are 20–60 min (`configs/phase4-ranges.json`), against phase 3's 10–40 min, so that
three turns and a speed change fit: about 0.4 redraws per accepted scenario, 54% of scenarios reach
zig + 20 min, and 44% of G5 rows are settled. Windows lengthen with the count (median 39 min with
no manoeuvre, 51 min with three turns and a speed change).

All parameters are float32-rounded before use, so the metadata describes the data exactly. Ranges
without a turn rate consume the random stream exactly as generator 0.1.0 did, ranges without the
0.3.0 options exactly as 0.2.0 did, ranges without a target manoeuvre exactly as 0.3.0 did, and
ranges without the 0.5.0 fields exactly as 0.4.0 did.
Each reproduces earlier datasets byte for byte.

## Motion

Zig sample `k = round(f · S)`, zig time `t_z = k · dt`, leg-2 course `c₁ = c₀ + zig`.

### Instantaneous zig (no turn rate; iterations 0–1)

Ownship at sample `i` (time `t = i · dt`), speed `v`:

- `i < k`: `p(t) = v t (sin c₀, cos c₀)`
- `i ≥ k`: `p(t) = v t_z (sin c₀, cos c₀) + v (t − t_z)(sin c₁, cos c₁)`

`zig_index = k`.

### Rate-limited turn (iteration 2)

A real ship cannot change course instantly (SRD §3: "instantaneous in iteration 1, then
rate-limited"). With turn rate `ω`, ownship keeps speed `v` and turns towards the zig side at a
constant rate starting at `t_z`, from the leg-1 point `p_z = v t_z (sin c₀, cos c₀)`. The turn lasts
`T = |zig| / ω`. With the signed rate `ω_s = sign(zig) · ω` (positive = clockwise, to starboard) and
`τ = t − t_z`:

- course `c(τ) = c₀ + ω_s τ`
- position on the arc (closed form; centre `|v/ω|` abeam on the turn side):
  `p = p_z + (v / ω_s) · (cos c₀ − cos c(τ), sin c(τ) − sin c₀)`

So ownship is on leg 1 for `i ≤ k`, on the arc while `τ < T`, and on leg 2 from the arc's end point
`p_T` afterwards: `p = p_T + v (τ − T)(sin c₁, cos c₁)`. Worked check: heading north at 5 m/s, a
90° turn at 1°/s ends 90 s later at `(r, r)` from its start, `r = v/ω ≈ 286.5 m`, on course 90°.

Metadata: `turn_start_index = k + 1` (the first sample after the turn starts) and `zig_index` = the
first sample with `τ ≥ T`, i.e. the first sample on leg 2. Everything downstream that uses
`zig_index` (loss masking, "zig + 300 s" gate points, curves) therefore measures time on the new
leg, as in iteration 1. A turn that would not finish inside the window is redrawn (it cannot happen
with the iteration-2 ranges: at most 180 s of turn against at least 240 s after the turn starts).

### Across the line of sight (iteration 3)

Under `zig_rule: across_los` each turn is chosen from the geometry at its start, not drawn. Take
ownship at `p` on course `c` and the true bearing `b` to the target at the last sample before the
turn. The relative bearing is `ρ = b − c`, wrapped to (−180°, 180°].

- **New course.** The turn puts the target on the other bow at the drawn offset `φ` (30–90° in
  iteration 3): the new course is `b + sign(ρ) · φ`.
- **Turn direction.** The turn takes the shorter way, so `zig = wrap(b + sign(ρ) φ − c)` and
  `|zig| ≤ 180°`.

- **Through the bow line of sight.** When `|ρ| + φ < 180°` the turn is towards the target.
- **Through the stern line of sight.** Otherwise the shorter turn is away from the target.

Either way, ownship's velocity component across the line of sight reverses, which is what makes
the bearings informative (spec 007 research R4). The rule holds at the start of the turn. During
a long turn at short range the bearing keeps drawing, so on the new leg the angle off can fall
outside the drawn range, and in rare cases the target returns to the original bow. Turns near
180° can go either way for a tiny change in geometry. The realised turn is stored as
`zig_angle_rad`, so the tracks depend only on the parameters.

Worked check: heading north with the target 40° on the starboard bow and `φ` = 60°, the turn is
100° to starboard. With the target on the starboard quarter (150°) it is 150° to port.

### Second zig (iteration 3)

With `zig2_delay_s` the second turn starts at sample `k₂ = zig_index + round(delay / dt)`, still
on the leg-2 course. It follows the first turn's conventions:

- **Turn.** It is instantaneous at `k₂`, or an arc at the same turn rate.
- **Indices.** `turn2_start_index = k₂ + 1`, and `zig2_index` is the first sample on leg 3.
- **Redraws.** A second turn that does not finish inside the window is redrawn. Gate times still
  count from `zig_index`, the end of the first turn.

Target: `q(t) = r₀ (sin β₀, cos β₀) + v_t t (sin θ_t, cos θ_t)`.

If the range `|q − p|` falls below `min_range_m` (100 m) at any sample, the parameters are redrawn
from the same stream; the redraw count is recorded in the dataset header.

## Observations

For each sample: `ε ~ N(0, σ²)` and `u ~ U[0, 1)` are drawn (always both, so the stream does not
depend on outcomes). The bearing is `wrap(atan2(q_x − p_x, q_y − p_y) + ε)`. If `u < d` the sample is
a dropout: `valid = false`, bearing stored as 0.

## Provenance

Every dataset header records the code that generated it: `generator_git_commit` (the checkout's
commit) and `generator_git_dirty` (uncommitted changes, untracked files included). `tma-generate`
refuses a dirty tree, or a directory outside git, unless `--allow-dirty` is given; the header then
says `generator_git_dirty: true` (commit `"unknown"` outside git).

The header travels with the data: features files (format 2) embed the source header and the
dataset file's SHA-256, and `tma-train` refuses features whose lineage is missing, dirty, from a
generator that differs from the commit at which G0 was verified, from different datasets for train
and validation, or built for another feature set. The model manifest records the source header and
the G0 experiment the training guard accepted. See [feature layout](feature-layout.md).

## Checks

Hand-computed known answers (`packages/sim/test/unit/known-answer.test.ts`, and for the turn
`turn.test.ts`) check the frame independently of the classical solver, so a sign or frame error
shared by generator and solver cannot pass unnoticed. G0's `independent-geometry` check includes an
in-turn case: the bearing half-way through a 60° turn at 1°/s, computed with literal `Math.atan2` from
the closed-form arc.

### Target course change (generator 0.4.0)

The target holds course and speed `v_t` to the start sample `k_m`, then turns at the drawn rate
`ω_m` on a constant-radius arc (`arcPosition`, as ownship's turns) for `|Δθ| / ω_m` seconds, then
holds the new course `θ_t + Δθ` at the same speed. Metadata `manoeuvre_start_index` is `k_m + 1`
(the first sample after the turn starts) and `manoeuvre_index` the first sample after it ends;
both are absent when the target holds course. Gate times for G4 count from `manoeuvre_index`.

Ownship's zigs under `zig_rule: across_los` are planned on the target's straight track, as an
operator plans on the current solution. After the target turns, a later zig need not put the
actual target across the line of sight; G0 checks the rule against the straight track.

### Several target manoeuvres (generator 0.5.0)

The target holds course and speed between manoeuvres. A **course change** is a constant-rate arc at
constant speed, as in 0.4.0. A **speed change** is constant acceleration `a` along the course for
`|Δv| / a` seconds: the distance run is `v τ + ½ a τ²`. Each manoeuvre starts from the exact state
where the previous segment ended, in closed form, so errors do not accumulate. Stored target speeds
vary from 0.5.0 on.

Metadata `manoeuvres` lists each one's kind and sample span (first sample after it starts, first
after it ends). `manoeuvre_start_index` is the start of the **first** manoeuvre, so G0's
`beforeManoeuvre` cuts every scenario where the constant-velocity fit stops holding, and
`manoeuvre_index` is the end of the **last**.

G0 adds, for 0.5.0:
- **Known answers** for a speed change, during and after it, and for two turns in sequence.
- **Step-by-step kinematics** (`targetManoeuvresFailure`). Outside a manoeuvre, course and speed
  are constant and each step is v·dt along the course. In a turn, each interior step turns ω·dt at
  constant speed. In a speed change, each interior step changes speed by a·dt on a constant
  course. The summed change of each manoeuvre equals the drawn one.
- **Timing and bounds** (`manoeuvreTimingFailure`). These cover the spacing, the start after the
  zig and the end margin, and target speeds within range.

