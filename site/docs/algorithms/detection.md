# Manoeuvre detection (CUSUM and detectors from frozen models)

Source: `cusumDetect`, `disagreementDetect` and `courseRateDetect` in
`packages/classical/src/detect.ts`; scoring in `packages/eval/src/gate-g6.ts`. CLIs: `tma-detect`
(scores) and `tma-g6` (calibration and gate).

Requirements: SRD Annex C §C.12, spec 017.

## Detectors

Each detector gives a per-timestep score from zig_index + 1. An alarm is a score at or above the
detector's threshold.

- **CUSUM on the reference IMM's innovations** (the baseline), restarting at 0 when the tracker
  re-initialises. There are two kinds:
  - `nis` (variance): g ← max(0, g + min(NIS, clip) − c);
  - `mean` (mean shift, two-sided, on e = ν/√S clipped to ±clip): g± ← max(0, g± ± e − c), with
    score max(g+, g−).

  The clip matters. The reference IMM's NIS is heavy-tailed (quiet median 0.06, mean 0.83, 0.2%
  above 10), and one outlier would otherwise hold an alarm for hours.
- **Course disagreement**: |course_T2 − course_IMM| in degrees.
- **Course rate**: T2's own course change over the last w samples, in degrees.

## Scoring (G6)

- **Events.** Target course changes on σ = 1° scenarios. Each window runs 10 min from the start,
  cut at the next manoeuvre's start.
- **Delay.** The time to the first row in the window at or above the threshold. A detector
  already alarming on the row before the start is credited nothing.
- **False alarms.** Alarm onsets on quiet (settled) rows, per hour.
- **Thresholds.** Each detector's is calibrated on validation to the same false-alarm rate, 0.5
  per hour.

## Result: phase 5 stopped at validation (seed 211)

| Detected within 5 min | 0.5 false alarms/h (declared) | 1/h | 2/h | 5/h |
| --- | --- | --- | --- | --- |
| Best CUSUM (mean, c 0.5, clip 3) | **28.2%** | 38.0% | 47.8% | 62.6% |
| T2's course change over 1 min | **19.2%** | 39.0% | 58.1% | 71.7% |
| T2 against the IMM, course disagreement | 5.9% | 12.8% | 22.9% | 47.9% |

At the declared operating point the CUSUM wins (−8.95 pp [−10.16, −7.73]). The learned detector
was not carried to a test split. From about 1 false alarm per hour it catches more, as a reported
observation only.

The record is `experiments/20261105-p5-research/validation.md`.
