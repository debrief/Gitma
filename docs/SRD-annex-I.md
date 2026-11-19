# SRD Annex I: the detector's early-alarm label

Nov 19, 2026 · annex to [SRD.md](SRD.md)

## I.0 Status and scope

Annex H's trained detector stopped at validation (§H.6): at 0.5 false alarms per quiet hour it
caught 11.1% of course changes within 5 min against the best re-tuned CUSUM's 12.2%, and was
slower on the turns both caught (1.46 ×). Its label counted the whole 5 min after a turn as
positive, which rewards a late, sustained alarm. Its probability sat near 0.6 even on quiet rows.

The owner's decision (2026-11-19):

- **I1:** retrain the detector with an early-alarm label.

Everything else is Annex H's: the architecture, the reference CUSUMs, the operating point, G6
under rules `h`, a fresh test seed and a review panel. The rest of this annex was written by the
implementing agent. It stands unless the owner amends it before decision 46 is committed.

## I.1 The label

`detector_onset_rows` (schema 0.26.0; `detectorOnsetLabel`): label 1 only in the first k rows after
a course change begins, a course change beginning at a row whose stored course differs from the
row before after 30 rows of steady course; label 0 on quiet rows (as Annex H); no loss on the rest
of a turn or the 5 min after it, on rows where only the speed changed, or in a window's first 30
rows. **k = 12** (2 min): the reference CUSUM's median delay among detected turns was 150 s, so a
detector that fires within 2 min would beat it.

## I.2 Training and validation

- **Training.** `configs/phase18/a` (seed 241, 100,000 scenarios, phase-7 ranges, pinned digests);
  `det-onset`: Annex H's configuration with `detector_onset_rows` 12 and train seed 1803.
- **Validation.** Annex H §H.2's protocol on seed 217's split (the twelfth selection on it), reusing
  phase 17's split and 16 CUSUM files after a hash check (`experiments/20261119-p18-val/run.sh`):
  the same reference rule (the CUSUM with the most course changes within 5 min at 0.5 per hour),
  the same carry rule, and the other operating points reported beside phase 17's detector.

## I.3 The gate

As Annex H §H.3: `tma-g6 --rules h` at thresholds frozen in decision 46; fresh seed 242
(400,000; a 40,000-scenario test split, phase-7 ranges); one re-score on seed 243 (1,100,000;
110,000); a five-reviewer panel.

## I.4 Forecast, stated before training

A pass is unlikely (about 20%). For: the label now rewards exactly what G6 counts, an early onset.
Against: phase 17's limit looked like the error, not the label (every detector caught 11–12%), and
an onset label has fewer positives (about 12 rows per turn) to learn from.

## I.5 What follows

- **Pass:** a trained detector beats the re-tuned CUSUM at a strict operating point; wiring it into
  the fused tracker becomes the next design.
- **Stop or fail:** the label is recorded as not the limit; the owner decides.
