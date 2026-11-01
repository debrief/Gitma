# Phase 4 on validation (spec 012 T010, decision 29): stop, neither tracker carried

## Source

- **T1, `learned-gain-filter`.** Run 41194775176 (`train/p4a-r2`, plan `configs/phase4/a`, commit
  1daa232, which includes the gain fix from #69). It stopped early after 74 epochs and kept epoch 67
  (validation loss 0.939). The model is `../20261031-p4a-models/models/tracker` on `results/p4a-41194775176`,
  weights SHA-256 5031a2e1….
- **T2, `lstm-gaussian`.** Run 41269549428 (`train/p4b-r2`, plan `configs/phase4/b`, commit d0aec60).
  It stopped early after 63 epochs and kept epoch 56 (validation loss −9.548). The model is
  `../20261101-p4b-models/models/tracker` on `results/p4b-41269549428`, weights SHA-256 05e36db5….
- **Both trained after decision 29** (`../20261030-p4-decision/`) and its amendment were committed.
- **Data.** Seed 211's validation split (10,000 scenarios; 4,951 at σ = 1° give the 16,500 G5 rows).
  Train and validation content digests match the plans. The local files were generated at another
  commit, so only the provenance header differs (prediction checked and noted it).
- **Reference.** The frozen `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8`, re-run on the same file; the EKF
  `ekf-sa0.03-p4-r8` is reported beside it.
- **Command.** `tma-g5` with both trackers and no decision (`diagnostic.json`, `report.json`).
  Naive on the same rows is in `naive.json`; batch least squares on the same rows is in
  `../20261030-p4-research/tune-ext.json`. T2's calibration is in `calibration.json`
  (`scripts/research/spec012-calibration.mjs`).
- **Statistics.** σ = 1°; scenario-clustered paired bootstrap, 97.5% intervals, 2,000 resamples.

**The test split (seed 212) has not been scored.** It stays reserved and unseen.

## Validation rule: stop

Decision 29: a tracker is carried only if every gated check's point meets its limit and no
interval lies wholly beyond it.

| Gated check (tracker / IMM, medians) | Limit | T1 | T2 |
| --- | --- | --- | --- |
| Overall range | < 1 | 2.18 [2.09, 2.26] | **0.85 [0.82, 0.88]** |
| Overall course | < 1 | 1.32 [1.26, 1.38] | **0.84 [0.81, 0.88]** |
| Settled range | < 1.1 | 2.80 [2.62, 2.99] | **0.97 [0.92, 1.03]** |
| Settled course | < 1.1 | 2.12 [1.99, 2.27] | **1.44 [1.37, 1.54]**, fail |
| Settled speed | < 1.1 | 2.30 [2.15, 2.47] | **1.66 [1.56, 1.78]**, fail |
| Reported: overall speed | | 1.81 | 1.33 [1.28, 1.39] |
| Reported: gross-error rate, tracker − IMM | | +1.9 pp | −3.5 pp [−4.1, −2.9] |

- **T1 fails every check.** Its range error stays at 19–22% from zig + 5 to zig + 20 min: it does
  not converge in range at all.
- **T2 fails two checks, each with its whole interval above the limit.** It is better than the IMM
  overall and level with it on settled range, but worse on settled course and speed.
- **Neither tracker is carried, so G5 is not run.** Annex C §C.6 and decision 28 (D4) apply: the
  owner decides the follow-on.

## The numbers (σ = 1°, medians, G5 rows)

| Estimator | All rows: range | course | speed | Settled: range | course | speed | Held course (no manoeuvre): range | speed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **T2** (LSTM, Gaussian) | **7.8%** | **19.3°** | 2.54 kt | 7.0% | 10.7° | 2.16 kt | 5.8% | 1.88 kt |
| T1 (learned-gain filter) | 20.1% | 30.3° | 3.45 kt | 20.2% | 15.7° | 2.99 kt | 18.0% | 2.66 kt |
| IMM, reference | 9.2% | 23.0° | 1.91 kt | 7.2% | 7.4° | 1.30 kt | 4.1% | 0.69 kt |
| EKF | 9.7% | 27.7° | 1.73 kt | 7.1% | 5.2° | 1.08 kt | 3.7% | 0.51 kt |
| Batch least squares | 12.2% | | | 6.7% | | | | |
| Naive | 39.5% | 88.9° | 4.00 kt | 40.0% | 88.6° | 4.14 kt | 38.8% | 4.35 kt |

- **Rows.** All: 16,500 rows in 4,951 scenarios. Settled: 7,222. Held course: 1,979.
- **By gate time, T2 / IMM range.** 6.3 / 5.5% at zig + 5 min, 7.5 / 9.2% at + 10, 9.2 / 13.0% at
  + 15 and 10.8 / 16.6% at + 20. T2's advantage grows with the number of manoeuvres seen.
- **By manoeuvre count, T2 / IMM course.** 7.1 / 3.7° held, 16.6 / 20.3° after one turn, 25.2 /
  34.9° after two and 34.5 / 46.0° after three.
- **Settled rows at zig + 5 min** are mostly rows before the first manoeuvre. There T2's speed
  error is 2.01 kt against the IMM's 0.69 kt.

## T2's calibration (reported, decision 29)

| | Within ±1 sd (expect 68.3%) | Within ±2 sd (expect 95.4%) | Median z |
| --- | --- | --- | --- |
| Log range | 71.1% | 94.9% | +0.06 |
| vx | 71.7% | 94.8% | −0.01 |
| vy | 72.8% | 94.9% | +0.02 |

T2's stated uncertainty is close to calibrated, slightly wide at 1 sd with slightly heavy tails.
It is unbiased in log range and velocity.

## Against the forecast

| Forecast (decision 29) | Outcome |
| --- | --- |
| T1: overall range ≈ 0.95 ×, settled speed ≈ 1.1 ×, P(carried) ≈ 35% | 2.18 ×, 2.30 ×; not carried. The forecast was badly wrong: T1 never learned range. |
| T2: overall range ≈ 0.9 ×, settled speed ≈ 1.5 × (1.2–2.0), P(carried) ≈ 10% | 0.85 ×, 1.66 ×; not carried. Close to forecast. |
| G5: P(pass) ≈ 20% | Not run. |

## Notes for the write-up

- **The pattern of phases 3 and 3b holds a third time.** A recurrent network beats the tuned
  trackers after manoeuvres (here overall range 0.85 ×, course 0.84 ×) but not on straight
  segments, where its speed and course are 1.4–1.7 × worse. With 0–3 manoeuvres the post-manoeuvre
  advantage now covers the overall checks, but the settled checks still fail.
- **T1's failure is a design finding.** A learned gain in the line-of-sight frame contracts the
  bearing loop, but its along-line-of-sight (range) gain must change sign with geometry, and the
  GRU did not learn it from innovation, range and velocity. Training was also unstable (spikes
  at epochs 14, 27 and 68).
- **Training history.** T1's first run diverged; it was fixed before any result (#69, decision 29
  amendment). T2 was restarted from scratch at a later commit when cross-commit resume was
  refused (#70); its fresh run reproduced the first one's epochs exactly.
