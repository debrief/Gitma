# Iteration 4 re-score decision (SRD §7)

Committed before any seed-206 data are generated. `tma-g2 --rescore-of` refuses the re-score
unless all of the following hold.

- **This record** is committed. It names the plan (`configs/iter4/r/plan.json`, with
  `fresh_test_count` 1,000,000), the test seed (206) and the re-scored gate
  (`experiments/20261024-i4-g2`).
- **Every carried model** matches the SHA-256 listed here for its `weights.bin`, `manifest.json`
  and `model.json`. The weights must also equal the digests recorded in the re-scored gate's
  manifest.
- **The re-scored gate** is committed, inconclusive and decided by a panel round.
- **The plan** differs from its content at this record's commit only in the fresh test digest.
- **The test data** come from a clean tree.
- **The experiment folder** sits beside the re-scored gate and holds no earlier re-score marker.
  No sibling folder has re-scored the gate, and no other committed decision names it.

## Why

G2 on seed 205's test split was **inconclusive** (`../20261024-i4-g2/`, panel round 1: all five
reviewers approve with findings):

- **Instantaneous speed:** 0.981 kt [0.940, 1.031] against 1 kt, so the interval holds the
  threshold.
- **Every other check passes:** time-late speed 0.754 kt [0.722, 0.789]; range and course for both
  models; G1 ratios, controls and shuffled labels.

SRD §7 (since 2026-10-11, commit 730c035): *an inconclusive interval allows one re-score on a
larger fresh-seed test set, then fails.* The owner chose the re-score at 100,000 scenarios on
2026-10-24.

## What is re-scored

- **Models.** The five iteration-4 models of record, frozen: no retraining, recalibration or other
  change. `decision.json` lists each `weights.bin` SHA-256; `tma-g2` refuses any other weights.
  - `lstm-instantaneous` 495e2502…
  - `bilstm-time-late` 71fcb706…
  - `cnn-causal-control` b4f4cde2…
  - `mlp-control` 589be566…
  - `lstm-instantaneous-shuffled` 0bfc5e87…
- **Test data.** The test split of seed 206 at 100,000 scenarios: indices 900,000–999,999 of a
  1,000,000-scenario dataset under `configs/iter4-ranges.json` (generator 0.3.0), generated alone.
  Its content digest is pinned in the plan after this record is committed and before scoring.
- **Normalisation and baselines.** Seed 205's training split, as the models were trained: inputs
  are normalised with its constants, and naive is fitted on it.
- **Beside.** The iteration-3 models as the other phase, reported only.
- **Not re-scored.** The held-out split (seed 205's, already reported).

## What decides

The full G2 verdict on seed 206 alone:

- **What decides.** The `result` that `tma-g2` writes to `verdict.json` (`g2Verdict`).
  - **Its inputs.** All six G2 thresholds (range and course at zig + 300 s, speed at zig + 600 s,
    for both models), the G1 ratio checks and the shuffled-label check.
  - **Time-late consistency.** A failed time-late-not-worse check makes the result inconclusive,
    which here means fail.
  - **Reported only.** The control checks.
- **Unchanged.** The same σ = 1° slice, gate points, bootstrap (2,000 resamples, seed 20261011)
  and FR-015 rule.
- **Outcomes.** A pass is a G2 pass. A fail or inconclusive is a G2 fail, and final.
- **Not pooled** with seed 205; both results are reported.
- **Once.** `tma-g2` refuses a second scoring into the same folder, a second re-score of the same
  gate, and a re-score of a re-score.

## Forecast, recorded before the re-score

At 100,000 scenarios about 32,500 rows reach zig + 600 s at σ = 1°. The interval is asymmetric,
about 0.013 kt below the median and 0.016 kt above it, so a pass needs a point estimate below
about 0.984 kt. Panel statistics simulated the chance of a pass for the instantaneous model:

| True median | 0.96 kt | 0.97 kt | 0.98 kt | 1.00 kt |
| --- | --- | --- | --- | --- |
| P(pass) | 1.00 | 0.98 | 0.78 | 0.02 |

A prior centred on the seed-205 test estimate (0.981 ± 0.022 kt) gives about 0.55.

Further points from the panel's simulation:

- **Outright fail.** For true medians at or below 0.98 kt the chance of an outright fail is about
  zero. A G2 fail could only come from another inconclusive interval.
- **At the threshold.** If the true median is 1.00 kt, P(G2 fail) is 0.98.
- **Two looks.** Allowing them raises the false-pass rate at the threshold from about 1.8% to
  about 3.7%. The SRD accepted that cost.
- **Time-late model.** Its fail risk is about zero (0.754 kt, 13 standard errors below the
  threshold).
- **Range and course.** Both pass by wide margins.
- **Expected bias.** The instantaneous model's speed bias should reappear: a median signed error
  of about −0.4 kt at zig + 600 s, and a slope of predicted on true speed of about 0.88. A
  markedly different bias would signal a changed model.

## How it is run

The re-score runs locally, once, from a clean tree after the digest-pinning commit, with an 8 GB
Node heap, into `experiments/20261025-i4-g2-rescore`. Its log is kept and every invocation is
recorded in that folder's `review.md`.

It is not run on CI: a `train/i4r` branch would train new models, which the digests would refuse.

`tma-g2` writes `rescore.json` before scoring and refuses any folder that already holds one. A
scoring run into a scratch folder outside `experiments/` is refused, because the folder must sit
beside the re-scored gate.

## Record fields

- `stalled` is true: the iteration-3 models are scored beside, which `tma-g2` treats as a phase B.
- `phase_a_experiment` names the re-scored gate.
- The command:

  `tma-g2 --split test --plan configs/iter4/r/plan.json --decision experiments/20261024-i4-rescore-decision/decision.json --rescore-of experiments/20261024-i4-g2 --compare-models experiments/20261021-i3a-val/models --models experiments/20261023-i4a-val/models --experiment experiments/20261025-i4-g2-rescore`

  The plan's `evaluate` step carries the same arguments.
