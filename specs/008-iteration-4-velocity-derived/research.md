# Research: Iteration 4 (spec 008)

## R1 — Where the iteration-3 LSTM's speed error comes from (2026-10-22)

These are the iteration-3 LSTM's and the classical solver's per-timestep predictions on seed 204's
validation split. The split decided nothing (the iteration stopped at validation) and its test
split is not read. Speed error is at zig + 600 s on the σ = 1° slice, by true target speed. The
LSTM figures match the run of record (`experiments/20261021-i3a-val/`): same weights
and data.

| True target speed | n | LSTM, median abs. error | LSTM, median signed error | Classical, median abs. error |
| --- | --- | --- | --- | --- |
| all | 3,165 | 1.10 kt | | 0.33 kt |
| 0–5 kt | 360 | 1.05 kt | +0.95 kt | 0.21 kt |
| 5–10 kt | 934 | 0.92 kt | +0.36 kt | 0.24 kt |
| 10–15 kt | 938 | 1.23 kt | +0.25 kt | 0.34 kt |
| 15–17.5 kt | 473 | 1.03 kt | −0.41 kt | 0.45 kt |
| 17.5–20 kt | 460 | 1.68 kt | −1.67 kt | 0.62 kt |

**Readings.**

- **The LSTM shrinks speed towards the middle of the range.** Slow targets are overestimated and
  fast ones underestimated. Classical is unbiased in every band (median signed error within
  ±0.01 kt).
- **The shrinkage is not mainly a scaling artefact.** The speed target is speed ÷ 15 kt
  (`speed_scale_mps`, ownship's maximum), so targets above 15 kt sit above 1.0. But the
  15–17.5 kt band is less biased than the 0–5 kt band, and the 10–15 kt band, inside the scale, is
  worse than 15–17.5 kt. This is the pattern of an uncertain estimator trained on squared error:
  it pulls towards the conditional mean.
- **Removing the bias would not pass G2.** Subtracting each 1-kt band's median signed error (an
  oracle correction no model can make) takes the LSTM from 1.10 to **1.01 kt**. The remaining
  error is scatter, not bias.

So an output change alone (lever B.2.2) is forecast to reach about 1.0 kt at best. That is why
the owner combined it with the derived features (B.2.3), which target the scatter: the network
gets the bearing rate it otherwise has to differentiate from noisy bearings itself.

Reproduce with [`scripts/research/spec008-r1-speed-bands.mjs`](../../scripts/research/spec008-r1-speed-bands.mjs): run it from the predictions folder
that `tma-g2 --split validation` writes for plan `configs/iter3/a`, passing
`../validation.f32pack validation.lstm-instantaneous.ndjson validation.classical.ndjson`.

## R2 — Why velocity components (2026-10-22)

The owner chose velocity components over rescaling speed, log speed or a separate speed head.

- **One smooth target for course and speed.** (vx, vy) has no wrap-around and no out-of-range
  values. Course and speed are derived: `atan2(vx, vy)` and `‖(vx, vy)‖`.
- **The scale is a constant of the problem.** `velocity_scale_mps` is the top of the generator's
  target speed range (10.29 m/s, 20 kt), so every component lies in [−1, 1]. It is not a truth
  statistic, so the inputs-only normalisation rule is untouched.
- **A known cost: magnitude shrinkage under course uncertainty.** Squared error on (vx, vy) pulls
  the estimate towards the mean velocity. Where the course is uncertain, the mean of velocity
  vectors pointing different ways is shorter than any of them, so speed is underestimated. At the
  iteration-3 course errors (about 5° at zig + 300 s) the effect is small (cos 5° ≈ 0.996). It is
  large only where course is badly wrong.
- **A second cost: course weighs less on slow targets.** There is no course term. A course error δ
  at speed v costs w_s·(v·δ / 10.29)², so course on a 3-kt target carries about 2% of the weight
  it carries at 20 kt. Course passed with margin in iteration 3 (6.2° against 10°); the risk is
  that it no longer does.

## R3 — Derived features (2026-10-22)

The `derived` set (13 channels) was built and tested in iteration 2 (spec 003 research R6) and
never trained on. It adds the trailing least-squares bearing rate, its validity flag and the
bearing-line intercept, all computed causally from bearings and ownship up to each row.

- **What it targets.** The bearing rate is the second-order quantity that, with ownship's
  manoeuvre, fixes range and speed. The panels' reading since G2 round 1 is that the models do not
  extract it well from raw bearings.
- **Cost.** Features files grow from 10 to 13 channels (train file 1.5 GB). Training time per
  epoch is expected to rise slightly; the 2 × 128 recurrent layers dominate.
- **Smoke run.** One epoch of the iteration-4 LSTM on 2,000 seed-205 scenarios: train loss 5.03,
  validation loss 1.84, both finite.

## R4 — What two levers at once cost

Changing two things means the record cannot say which one moved speed. The owner accepted this
after R1 showed that the output change alone is forecast not to pass. The write-up reports the
combination, not either lever. If the combination moves speed, a later single-lever run could
separate them; if it does not, both are set aside together.
