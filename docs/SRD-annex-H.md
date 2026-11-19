# SRD Annex H: a trained manoeuvre detector

Nov 18, 2026 · annex to [SRD.md](SRD.md)

## H.0 Status and scope

Three designs have now failed on the same weakness: telling a target manoeuvre from correlated
bearing error. The composite solver's fit check (Annex D) and NIS-adaptive process noise (Annex G)
could not; phase 5 (Annex C §C.12) found T2's own course change a weaker detector than a CUSUM at
its strict operating point, under white noise.

The owner's decisions (2026-11-18):

- **H1, the approach:** train a dedicated detector network.
- **H2, the gate:** G6, revised: stand-alone against the best CUSUM re-tuned to realistic error,
  detected-within-5-min shown better, false alarms matched, and delay judged on the events both
  detect (phase 5's lesson).

Earlier decisions stand: a fresh test seed and a review panel. The rest of this annex was written
by the implementing agent. It stands unless the owner amends it before decision 45 is committed.

## H.1 The detector

- **Output.** `manoeuvre_detector` (schema 0.25.0): one logit per row; prediction rows carry the
  probability as `p_manoeuvre`. `tma-detect --detector model --network <file>` makes the detection
  file `pman-<model>`, which `tma-g6` re-computes from its bound prediction file.
- **Label** (`detectorLabel`, from the stored truth course and speed): 1 where the target's course
  changed within the last 30 rows (5 min at dt 10 s), so turning and the 5 min after; 0 on quiet
  rows (neither course nor speed changed within them: G5's and G6's settled rows, where false
  alarms are counted); no loss where only the speed changed, or in a window's first 30 rows.
- **Model.** T2's architecture and settings (2 × 128 LSTM, derived features,
  `configs/phase17/a/detector.json`, id `det-lstm`, train seed 1703), masked binary
  cross-entropy. Causal: row i reads inputs up to i.
- **Training data.** Fresh seed 238 (100,000 scenarios, generator 0.6.0, phase-7 ranges: realistic
  bearing error), plan `configs/phase17/a/plan.json` with pinned digests; normalisation from its
  train split; trained on GitHub Actions; the committed weights are the artefact of record.

## H.2 Validation and the reference

Seed 217's validation split (phase-7 ranges, the eleventh selection on it; the detector never saw
it), as phase 16 regenerated it.

- **The CUSUM reference, re-tuned to realistic error** (16 settings): on each of the frozen `-g1`
  IMM and Annex E's re-tuned IMM, the clipped mean-shift CUSUM at c ∈ {0.1, 0.25, 0.5, 1} (clip
  3) and the NIS CUSUM at c ∈ {0.05, 0.1, 0.25, 0.5} (clip 5). The grid reaches lower c than phase
  5's because the re-tuned IMM's innovations are smaller (R × 64).
- **Thresholds.** Each detector's is set so its false-alarm rate on quiet rows is 0.5 per hour
  (phase 5's operating point; `calibrateThreshold`).
- **The reference** is the CUSUM with the most course changes detected within 5 min at that rate
  (ties: the lower false-alarm rate, then the first in the order above).
- **Reported:** T2's own course change over 1 min (`crate-…-w6`, phase 5's best learned
  detector), and every detector at 1, 2 and 5 false alarms per hour.
- **The carry rule.** The tma-g6 diagnostic under rules `h` on validation: carried if every
  point estimate meets its limit and no interval lies wholly beyond it (as phase 5).

## H.3 The gate: G6 under rules `h`

`tma-g6 --rules h` (decision field `g6_rules: "h"`), at the thresholds frozen in decision 45,
95% scenario-clustered paired bootstraps (2,000 resamples), one learned detector:

| Check | Statistic | Pass |
| --- | --- | --- |
| g6-detect5 | detected within 5 min, learned − CUSUM | lower bound > 0 |
| g6-delay-joint | median delay, learned / CUSUM, over events both detect | upper bound ≤ 1.25 |
| g6-false-alarms | false alarms on quiet rows, learned / CUSUM | upper bound ≤ 1.25 |

Pass if all pass, fail if any fails, otherwise inconclusive (FR-015).

- **Seeds.** Decision 45 fixes fresh seed 239 (400,000; a 40,000-scenario test split, phase-7
  ranges). One re-score on seed 240 (1,100,000; 110,000). A fail or inconclusive there is final.
- **Bindings.** The detector's weights by `model_digests`; its prediction file by its header's
  weights digest; both detection files re-computed on a seeded sample (spec 015).
- **Panel.** Five reviewers.

## H.4 Forecast, stated before training

A pass is plausible but not likely (about 35%). For: a network trained for exactly this label, on
this error, sees the whole bearing history; phase 5's untrained proxy (T2's course change) already
beat the CUSUM above 1 false alarm per hour. Against: at 0.5 per hour, phase 5's best detector
caught only 28% within 5 min; correlated error mimics slow turns; and detect5 must be shown
better, not merely no worse.

## H.5 What follows

- **Pass:** a learned detector beats the re-tuned CUSUM at a strict false-alarm rate under
  realistic error. Wiring it into the fused tracker (Annex G's σa and fade, switched on detection)
  becomes the next design, under its own annex.
- **Stop or fail:** manoeuvre detection under this error model is recorded as not improved by a
  trained detector at this operating point; the owner decides.

## H.6 Outcome (2026-11-19)

**Stopped at validation** (`experiments/20261118-p17-val/validation.md`). The detector trained to
epoch 26 of 33 (`experiments/20261118-p17a-models/`). At 0.5 false alarms per quiet hour it detects
11.1% of course changes within 5 min against the best re-tuned CUSUM's 12.2% (difference −1.08 pp
[−2.05, −0.15]: fail) and is slower on the events both detect (1.46 [1.29, 1.75]: fail). It is no
better than T2's untrained course change (10.7%). From 2 false alarms per hour the learned signals
catch slightly more than the CUSUM (reported). Seeds 239–240 were not generated and stay
reserved; decision 45 was not committed.
