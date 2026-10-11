# Naive baseline

Source: `packages/classical/src/naive.ts`. Requirements: SRD §5 baseline 1, spec 001 FR-013.

The naive baseline ignores the bearings entirely and predicts training-set means, so any model
that cannot beat it has learned nothing about geometry.

## Fit (train split only)

For each training label (the last sample of each scenario for `final`; every sample after
`zig_index` for `per_timestep`):

- mean of `ln(range / 1 km)`
- mean course vector `(mean sin θ, mean cos θ)`
- mean speed

## Predict

Every scenario receives the same estimate: range `exp(mean ln r)` km, course
`atan2(mean sin, mean cos)`, mean speed. The reported position uses the last valid bearing up to
that sample, so position error reflects range error only.

Because target courses are drawn uniformly, the mean course vector is short and the predicted course
is essentially arbitrary: the naive course error is ≈ 90° median by construction.

## Reproducibility

The fit is a deterministic pass over the training file; G0 fits it twice independently and requires
identical metrics (SC-005).
