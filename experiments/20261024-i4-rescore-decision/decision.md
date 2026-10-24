# Iteration 4 re-score decision (SRD §7)

Committed before any seed-206 data are generated. `tma-g2 --rescore-of` refuses the re-score
unless this record is committed, names the plan (`configs/iter4/r/plan.json`), the test seed (206)
and the re-scored gate (`experiments/20261024-i4-g2`), and lists the exact weights digest of every
carried model.

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

- **Checks.** All six G2 thresholds (range and course at zig + 300 s, speed at zig + 600 s, for
  both models), the G1 ratio checks and the shuffled-label check.
- **Unchanged.** The same σ = 1° slice, gate points, bootstrap (2,000 resamples, seed 20261011)
  and FR-015 rule.
- **Outcomes.** A pass is a G2 pass. A fail or inconclusive is a G2 fail, and final.
- **Not pooled** with seed 205; both results are reported.
- **Once.** `tma-g2` refuses a second scoring into the same folder, a second re-score of the same
  gate, and a re-score of a re-score.

## Forecast, recorded before the re-score

At 100,000 scenarios about 32,500 rows reach zig + 600 s at σ = 1°, so the interval half-width
is about 0.014 kt. Panel statistics simulated the chance of a pass for the instantaneous model:

| True median | 0.96 kt | 0.97 kt | 0.98 kt | 1.00 kt |
| --- | --- | --- | --- | --- |
| P(pass) | 1.00 | 0.98 | 0.78 | 0.02 |

A prior centred on the seed-205 test estimate (0.981 ± 0.022 kt) gives about 0.55.

The time-late model's fail risk is about zero (0.754 kt, 13 standard errors below the threshold).
Range and course pass by wide margins.

## Record fields

- `stalled` is true: the iteration-3 models are scored beside, which `tma-g2` treats as a phase B.
- `phase_a_experiment` names the re-scored gate.
- The command:

  `tma-g2 --split test --plan configs/iter4/r/plan.json --decision experiments/20261024-i4-rescore-decision/decision.json --rescore-of experiments/20261024-i4-g2 --compare-models experiments/20261021-i3a-val/models --models experiments/20261023-i4a-val/models --experiment experiments/20261025-i4-g2-rescore`

  The plan's `evaluate` step carries the same arguments.
