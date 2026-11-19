# Phase 18 validation (spec 031, SRD Annex I): the early-alarm detector

**Data.** Seed 217's validation split, phase 17's (7,433 course changes, 920.7 quiet hours); its
split and 16 CUSUM detection files reused after all 21 SHA-256s matched phase 17's
`inputs.sha256`. The twelfth selection on seed 217.

**Pre-registration.** Annex I, the label code, the training plan (`configs/phase18/a`, seed 241)
and `run.sh` were committed in b7f8220 before training. The model
(`experiments/20261119-p18a-models/`, CI run 44488069099, early stopping at epoch 18 of 25,
validation BCE 0.375 against 0.423 after the first epoch) was committed in 47f60b0 before this run.

## Outcome

**Stopped at validation.** Under G6 rules `h` against the same CUSUM as phase 17:

| Check | Value | 95% interval | Rule | Result |
| --- | --- | --- | --- | --- |
| g6-detect5 (learned − CUSUM) | −7.1 pp | [−8.0, −6.3] | lower bound > 0 | **fail** |
| g6-delay-joint (learned / CUSUM) | 0.50 | [0.44, 0.62] | upper bound ≤ 1.25 | pass |
| g6-false-alarms | 1.00 | [0.88, 1.15] | upper bound ≤ 1.25 | pass |

Seeds 242–243 are not generated and stay reserved; decision 46 was not committed. The forecast (a
pass about 20%) held.

## Detected within 5 min and median delay among detected (`rates.json`)

| False alarms per quiet hour | 0.5 | 1 | 2 |
| --- | --- | --- | --- |
| **Early-alarm detector** (Annex I) | 5.0%, 70 s | 9.3%, 70 s | 17.7%, 70 s |
| Phase 17's detector (5-min label) | 11.1%, 180 s | 20.5%, 170 s | 35.1%, 160 s |
| T2's course change | 10.7%, 160 s | 20.4%, 150 s | 34.5%, 140 s |
| Best CUSUM (reference) | **12.1%**, 150 s | **22.2%**, 140 s | 33.3%, 130 s |

At 5 per hour both trained detectors' alarms stand almost always (thresholds 0.04–0.05); not a
usable operating point.

## Critical reading

- **The label did what it was meant to, and it was not enough.** The early-alarm detector fires
  twice as fast as the CUSUM on the turns both catch (70 s against about 140 s), but catches half as
  many as phase 17's detector at every rate. Fewer positive rows (about 12 per turn) and a sharper
  target make it confident only on the clearest turns.
- **Neither label beats the CUSUM on catch rate.** The two trained detectors bracket it: one later
  and about as complete, one earlier and far less complete. Under this error the turns that are
  detectable at all are detectable by a CUSUM on a well-tuned tracker.
- **Not tried:** combining the two (the early detector's speed with the window detector's
  coverage), or a sequence loss that scores detection delay directly. Neither is suggested by a
  gap the data show large.
- **Limits.** One seed, validation only, one training run per label, one error family.

## Consequence

Annex I §I.5, stop: the label is not the limit. Manoeuvre detection under this error model is not
improved by a trained detector at the strict operating point, with either label. The owner decides.
