# Tracking filters: EKF and IMM

Source: `packages/classical/src/ekf.ts` (`ekfPredict`), `packages/classical/src/imm.ts`
(`immPredict`), CLI `tma-track`. Requirements: SRD Annex B §B.3 (as amended 2026-10-28), spec 010.

Phase 3's target can turn once. [Batch least squares](least-squares-solver.md) fits a single
constant-velocity track, so it cannot follow a turn. G4 needs a reference that can, and SRD Annex
B names a tracking filter.

## Common ground

Both filters:

- **Start where classical does.** They are initialised at `zig_index`, the first sample on leg 2,
  from the batch solution on samples up to it. The initial covariance is the batch fit's own:
  σ²(JᵀJ)⁻¹, propagated to that time.
- **Run causally.** They update once per bearing, so the row at sample t uses bearings up to t.
  They emit one row per sample from `zig_index + 1`, the same rows as `tma-solve --per-timestep`,
  so the estimators pair row for row.
- **Use the wrapped innovation.** The innovation is z − h wrapped to (−π, π], with a Joseph-form
  covariance update.
- **Take measurement noise from the scenario.** That is the scenario's σ, floored at 10⁻⁴ rad so
  that noise-free data keep the innovation variance positive.
- **Report divergence.** A state outside the [plausibility bounds](least-squares-solver.md) (over
  25 m/s or over 100 km) is reported as `converged = false`. The filter then re-initialises from
  the batch solution on the samples so far.

## EKF (constant velocity)

The state is (x, y, vx, vy). Process noise is white-noise acceleration σ_a (m/s²), and σ_a is the
only parameter.

The single-model EKF is reported in phase 3 but is not the gated reference. Spec 010's first tests
showed why:

- **Before the turn it is exact.** On noise-free data it holds the truth to about 10⁻⁶ in range.
- **After the turn it usually drifts.** In the first hand-built case (a 90° starboard turn followed
  by an ownship zig) its range error grows to about 50% twenty minutes after the turn at every
  ratio σ_a/σ tried, while a batch fit on the post-turn bearings alone recovers the truth exactly.
  It is not hopeless everywhere: the G0 panel found the mirror-image port case ends at 0.33% with
  σ_a/σ = 0.32.

The mechanism (G0 panel, numerics, reproduced with an independent EKF and a UKF): a
constant-velocity model carried through the turn, then covariance collapse. While ownship holds
course, every scaled track own + k(target − own) explains the bearings equally well, and the
filter drifts along that family. It is related to, and looser than, the Cartesian instability
Aidala described (1979).

## IMM (constant velocity + coordinated turn)

The interacting-multiple-model tracker (Blom and Bar-Shalom) runs two EKFs on the state
(x, y, vx, vy, ω):

- **CV:** constant velocity, white-noise acceleration σ_cv. It carries ω but does not use it.
- **CT:** coordinated turn at rate ω (positive is clockwise, as the generator's turns), with
  white-noise acceleration σ_ct and a turn-rate random walk σ_ω.

Each step:

1. **Mix.** Each model's prior blends both estimates through a two-state Markov chain whose
   switch probability is `switch` per second.
2. **Predict.** Each model predicts, using a numerical Jacobian of its motion.
3. **Update.** Each model takes the bearing.
4. **Reweight.** The innovation likelihoods reweight the model probabilities.
5. **Report.** The output is the probability-weighted mixture.

The prior on ω at initialisation has a standard deviation of 0.05 rad/s, and the initial model
probabilities are 0.9 (CV) and 0.1 (CT).

The four parameters (σ_cv, σ_ct, σ_ω, switch) are tuned on the phase-3 validation split, frozen in
the decision record, and then used unchanged at G4 (spec 010 FR-004).

### What it does

- **Noise-free, with an ownship zig after the target's turn.** With G0's settings it ends within
  0.2% range on the hand-built 90° turn at 1°/s, in both directions; this is gated at G0 (check
  `tracker-noise-free`) and shows the implementation follows a turn. It is not a general
  re-convergence result: over 30–120° and 0.5–3°/s the same geometry is reported, not gated, and
  some fast turns stay far off; and other settings (for example the viewer's) fail the gated
  case itself.
- **At σ = 1°, before the turn.** With no CV process noise and rare switching (σ_cv 0,
  switch 10⁻⁵/s) its median range error at the last sample before the turn is about that of
  per-timestep batch least squares (3.1% against 3.4% on 120 scenarios). G0 gates the ratio at
  1.25 (check `tracker-noisy-sanity`). The check is one-sided: it catches an under-stated
  measurement variance (σ × 0.1 gives 2.1 ×), not an over-stated one (σ × 10 gives 1.002 ×), because
  with no CV process noise the filter is close to recursive least squares whatever R is. With G0's noise-free settings (switch 10⁻³/s) it is 1.8 × batch least squares:
  frequent switching leaks the turn model's noise into straight legs, so the tuning grid must
  include low switch rates. Turn-ready settings are about 1.7–1.8 × batch least squares on straight
  legs at the true σ, and telling them σ × 10 brings that to about 1.1 ×: a scale on R is a
  tuning lever too (G0 panel round 2).
- **Noise-free, before the turn.** Every row from zig + 60 s to the turn is within G0's
  tolerances (0.1% range, 0.1° course, 0.01 kt).
- **At σ = 1°, five minutes after the turn.** On 150 validation-like scenarios with untuned
  settings, its median range error is about 15.6%. The best single-model EKF reaches 14.8%,
  sliding-window least squares 42–100%, and batch least squares over the whole track 28%.

### Generator 0.5.0 (phase 4)

G0 on 0.5.0 (`experiments/20261030-g0-p4-r2/`) adds three tracker checks:
- **Re-convergence after every manoeuvre kind.** G0's IMM setting (σ_ct 0.01) cannot follow a
  deceleration: 0.93 range error on a hand-built −2 m/s case. With σ_ct 0.1, every hand-built case
  ends within 0.6% when ownship zigs afterwards: two turns either side, ±2 m/s, and turn, speed
  change, turn. A single coordinated-turn model with a signed ω handles S-turns poorly at small σ_ω.
- **A paired straight-leg ratio.** The median per-scenario ratio to batch least squares is 1.05
  over 1,000 scenarios, against a limit of 1.15. The ratio of medians, 1.17–1.26, was noisy on
  200 scenarios.
- **NIS.** The median per-scenario mean NIS, through `immPredict`, is 1.06 with the scenario's σ,
  0.71 with σ² × 1.5 and 1.38 with σ² × 0.75. The band is [0.75, 1.3], so a variance mis-scaled
  either way fails. The ratio check cannot see an over-stated variance, and on 0.5.0 it cannot see
  a mis-stated σ at all.

### Reading it critically

- **The IMM's advantage shows only with exact data.** At σ = 1°, five minutes after a turn, the
  best single EKF is level with or better than the best IMM tried so far (panel: medians 16.6%
  against 17.8%, P90 39.6% against 51.6%, on 200 scenarios). The decision record must settle
  whether G4 gates against the tuned IMM only or the better of the two tuned trackers, and widen
  the IMM grid (including a scale on the initial covariance). There the bearings, not the filter, limit what is
  knowable. That is the regime G4 judges, so a network that beats the IMM must extract
  information the filter leaves on the table: for example, a prior over how targets turn.
- **Re-convergence needs geometry.** When the target turns after ownship's last zig (about half
  of the turning scenarios), a filter with process noise can observe range again only through
  the continuity of position across the turn. A batch or smoothing fit that knows the speed is
  constant through the turn could do better: that prior is exactly what a network can learn. G0 reports
  the noise-free median error at manoeuvre + 5 min on generated scenarios but does not gate it.
- **The IMM is not the strongest possible reference.** A smoother, a particle filter, or an IMM
  in modified polar coordinates could do better. The owner chose the IMM on 2026-10-28 as the
  textbook tracker for manoeuvring targets (SRD Annex B, decision D3 revisited).
- **Re-initialisation is crude.** After an implausible state the filter restarts from a
  constant-velocity batch over every sample so far, turn included.
- **Initialisation after an instantaneous zig is slow.** With iteration 1's instantaneous zig,
  the batch solution the filter starts from is nearly unobservable, and the IMM needs more than
  60 s to settle (worst 1% range). Phase-3 data have rate-limited turns, where it settles within
  60 s. G0 gates the tracker on generator-0.4.0 data only.

## Running it

```
pnpm tma-track --in <split.f32pack> --out <pred.ndjson> --filter imm \
  --sigma-cv 0.003 --sigma-ct 0.03 --sigma-omega 0.003 --switch 0.001
pnpm tma-track --in <split.f32pack> --out <pred.ndjson> --filter ekf --sigma-a 0.03
```

The estimator name records the settings (for example `imm-cv0.003-ct0.03-w0.003-s0.001`).
Predictions are written as they are made.

## Tuned for phase 3

On the seed-208 validation split at σ = 1° (spec 010 R2; `experiments/20261028-p3-research/`),
by median range error five minutes after the turn:

- **IMM:** 13.6% (σ_cv 0.003, σ_ct 0.1, σ_ω 0.001, switch 0.001/s, R × 2).
- **Single EKF:** 15.3% (σ_a 0.1, P0 × 4, R × 4).
- **Batch least squares:** 29.7%.

The IMM is therefore G4's frozen reference.

- **Held course.** Both trackers' straight tunings are within 0.3 points of batch least squares
  (3.2–3.3% against 3.0%).
- **Under noise, after the turn.** Where ownship zigs after the turn, the reference reaches 12.5%,
  against 31.5% for a batch fit on post-turn bearings alone. It uses the pre-turn track, as it
  should.


## Re-tuned for phase 4

On the seed-211 validation split (generator 0.5.0: 0–3 course changes, one speed change in 30%),
by median range error over all G5 rows (σ = 1°, zig + 5/10/15/20 min; spec 012 R2,
`experiments/20261030-p4-research/`):

- **IMM:** 9.24% (σ_cv 0.01, σ_ct 0.03, σ_ω 0.01, switch 0.001/s, P0 × 4, R × 8): G5's frozen
  reference, `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8`.
- **Single EKF:** 9.72% (σ_a 0.03, P0 × 4, R × 8).
- **Batch least squares:** 12.2% overall, but 6.7% on settled rows, where the IMM reaches 7.2%.
  A batch fit over a long straight segment beats a recursive filter there.

Two declared grids were run, the second because the first's optimum sat on its R and P0 edges.
The surface is flat in σ_cv and σ_ct: the top four settings are within 0.05 points.
