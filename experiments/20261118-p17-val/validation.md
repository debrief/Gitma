# Phase 17 validation (spec 030, SRD Annex H): a trained manoeuvre detector

**Data.** Seed 217's validation split (phase-7 ranges, realistic bearing error): 7,433 target course
changes in σ = 1° scenarios and 920.7 quiet hours. The eleventh selection on seed 217; the detector
never saw it.

**Pre-registration.** Annex H, the training plan (`configs/phase17/a`, seed 238, pinned digests),
the code and `run.sh` were committed in 1d6c91f before training. The model
(`experiments/20261118-p17a-models/`, CI run 44261395631, early stopping at epoch 26 of 33,
validation BCE 0.578 against 0.652 after the first epoch) was committed in a44cc6a before this run.
Outputs: `validation/` (the carried detector), `validation-crate/` (reported), `rates.json`
(reported; `scripts/research/spec030-rates.mjs`, written after the run), `inputs.sha256`.

## Outcome

**Stopped at validation.** Under G6 rules `h`, against the best re-tuned CUSUM (mean shift, c 0.25,
on Annex E's re-tuned IMM), the trained detector fails two of the three checks:

| Check | Value | 95% interval | Rule | Result |
| --- | --- | --- | --- | --- |
| g6-detect5 (learned − CUSUM) | −1.08 pp | [−2.05, −0.15] | lower bound > 0 | **fail** |
| g6-delay-joint (learned / CUSUM, 180 events both detect) | 1.46 | [1.29, 1.75] | upper bound ≤ 1.25 | **fail** |
| g6-false-alarms (learned / CUSUM) | 1.00 | [0.87, 1.16] | upper bound ≤ 1.25 | pass |

Seeds 239–240 are not generated and stay reserved; decision 45 was not committed. The forecast
(a pass about 35%) was too hopeful.

## At 0.5 false alarms per quiet hour (the operating point)

| Detector | Threshold | Detected within 5 min | Missed in 10 min |
| --- | --- | --- | --- |
| **CUSUM, mean, c 0.25, re-tuned IMM (reference)** | 1.249 | **12.2%** | |
| CUSUM, NIS, c 0.1, re-tuned IMM | 0.647 | 11.9% | |
| CUSUM, mean, c 0.25, `-g1` IMM (phase 5's best family) | 6.33 | 9.3% | |
| **Trained detector `pman-det-lstm`** | 0.660 | 11.1% | 88.3% |
| T2's course change over 1 min (reported) | 133° | 10.7% | 87.8% |

All 16 CUSUMs are in `validation/calibration.json` (4.1–12.2%). The re-tuned IMM's CUSUMs beat the
`-g1` IMM's at every setting.

## Other operating points (reported, `rates.json`)

| False alarms per quiet hour | 0.5 | 1 | 2 | 5 |
| --- | --- | --- | --- | --- |
| Trained detector, within 5 min | 11.1% | 20.5% | **35.1%** | 5.0%* |
| T2's course change | 10.7% | 20.4% | 34.5% | **60.0%** |
| Best CUSUM (reference) | **12.1%** | **22.2%** | 33.3% | 51.0% |
| Trained detector, median delay among detected | 180 s | 170 s | 160 s | — |
| Best CUSUM, median delay among detected | 150 s | 140 s | 130 s | 120 s |

\* At 5/h the trained detector's threshold falls to 0.047: its probabilities sit near 0.6 on quiet
rows, so the alarm stands almost always and a standing alarm detects nothing new. Not a usable
operating point.

## Critical reading

- **Under realistic error every detector is weak at a strict false-alarm rate.** The best catches
  12% of course changes within 5 min at 0.5/h, against 28% under white noise in phase 5. Correlated
  bearing error produces turn-like signatures on quiet legs, which set the thresholds.
- **Training did not beat the untrained proxy.** The detector trained for exactly this label is no
  better than T2's course change (11.1% against 10.7% at 0.5/h; 35.1% against 34.5% at 2/h) and is
  slower than the CUSUM among events both catch (1.46 ×). Its score is poorly separated: quiet rows
  sit near 0.6, so its usable range is narrow.
- **The crossover phase 5 saw persists, weakly.** From about 2/h the learned signals (trained and
  T2's) catch slightly more than the CUSUM, and at 5/h T2's course change catches 60% against 51%.
  At the declared operating point they do not; the operating point stays as declared.
- **Likely causes, untested.** The label counts the 5 min after a turn as positive, so the network
  is rewarded for late, sustained alarms rather than early onsets; the 30-row look-back starts
  before the event's detection window; and the masked quiet rows are a minority of training rows.
  A label on the first minutes after a turn starts, or an onset-weighted loss, are the obvious
  variants.
- **Limits.** One seed, validation only; one training run; one label definition; one error family.

## Consequence

Annex H §H.5, stop: under this error model a trained detector does not improve manoeuvre detection
at the strict operating point. The owner decides.
