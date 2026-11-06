# Spec 017 research (validation only, seed 211)

The full record is `experiments/20261105-p5-research/validation.md`, with `calibration.json`,
`diagnostic.json`, `sensitivity.json` and `run.sh`.

- **R1 The reference's statistic.**
  - **Distribution.** The `-g1` IMM's NIS is heavy-tailed. On quiet rows its median is 0.06, its
    mean 0.83, its p99 1.0, and 0.2% of values exceed 10, up to 833. Around manoeuvres the mean
    is 1.26.
  - **What that does to a CUSUM.** An unclipped NIS CUSUM averages about 480 around turns. Hence
    the clipped kinds, and a two-sided CUSUM on the signed innovation ν/√S, since a turn biases
    the bearings to one side.
  - **Best setting.** On validation it is the mean-shift CUSUM, c 0.5, clip 3.
- **R2 The gate's delay check.**
  - At 0.5 false alarms per hour every detector misses more than half the course changes, so the
    median delays are +∞ and their ratio is undefined.
  - `g6Checks` reports that case as inconclusive and omits the value. It used to read as a fail,
    since ∞/∞ = NaN.
  - A later gate should declare a delay statistic that is defined at its operating point.
- **R3 Result.** The best learned candidate, T2's course change over 1 min, detects 19.2% within
  5 min against the CUSUM's 28.2% (−8.95 pp [−10.16, −7.73]). It is not carried. There is a
  crossover from about 1 false alarm per hour (reported, not gated).
