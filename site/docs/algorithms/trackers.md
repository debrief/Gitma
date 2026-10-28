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
- **Noise-free, before the turn.** Every row from zig + 60 s to the turn is within G0's
  tolerances (0.1% range, 0.1° course, 0.01 kt).
- **At σ = 1°, five minutes after the turn.** On 150 validation-like scenarios with untuned
  settings, its median range error is about 15.6%. The best single-model EKF reaches 14.8%,
  sliding-window least squares 42–100%, and batch least squares over the whole track 28%.

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
