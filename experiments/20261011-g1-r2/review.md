# G1 agent panel review

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open. Briefs: `specs/002-iteration-1-signal/g1-panel-briefs.md`.

Evidence under review: this folder, re-scored by `evaluate-g1.yml` run 38182021648 at edd0aa2
(main + PR #27) from the models in `experiments/20261011-g1/` (Actions artifacts of runs
38131616871 and 38152208243). The original g1 job (run 38152208243, train/i1 code) printed the same
checks but could not push its results branch (`train.yml` differs from main and the Actions token
lacks the `workflows` permission); its verdict survives only in that job's log.

Machine verdict: **fail**.

| Check | Result | Detail |
| --- | --- | --- |
| g1-instantaneous | pass | lstm-instantaneous / naive 0.419, 95% CI [0.407, 0.431] |
| g1-time-late | fail | bilstm-time-late / naive 0.551, 95% CI [0.538, 0.565] |
| time-late-not-worse | fail | time-late worse at 20/20 gated curve points |
| instantaneous-beats-control | pass | 0.161 vs CNN 0.293 (zig+300s) |
| time-late-beats-control | pass | 0.212 vs MLP 0.263 (zig+300s) |
| shuffled-labels-at-naive | pass | 1.005 × naive |

Training: bilstm-time-late stopped on the 5.5 h wall-clock cap (`max_wall_s` 19,800) after 25
epochs (≈ 775 s each), best epoch 23, validation loss still falling. lstm-instantaneous ran 60/60
epochs (≈ 276 s each), best epoch 58. Both configs had `max_epochs` 60 and the same cap.

## Round 1 (2026-10-11/12)

| Reviewer | Verdict |
| --- | --- |
| TMA geometry | approve-with-findings |
| Estimation and numerics | **reject** |
| Evaluation statistics | approve-with-findings |
| Reproducibility (re-ran G1 locally from the committed weights: `verdict.json` byte-identical; naive and classical metrics byte-identical; model metrics within 1.3e-5 relative) | approve-with-findings |
| Red team | approve-with-findings |

### What every reviewer agreed

- The pipeline is sound. Masking in the bidirectional pass is exact (padded vs unpadded runs differ
  by 0.0 on 5–12 windows, at inference and with `training: true`); output rows align with input
  samples; causal models are unaffected by future bearings; the BiLSTM does use them (truncating
  after the gate row worsens its median from 0.212 to 0.272).
- Data identity: regenerated seed-101 data reproduces the dataset digests and, with the 0.4.0
  header digest, the train/validation feature digests in every model manifest. PR #27's tolerance
  hides no data change (the packs differ by the version string only).
- The instantaneous pass is not spurious: no truth in inputs or normalisation, naive not
  artificially weak, identical scenario sets (9,784) for every pair, the 216 exclusions are windows
  ending before zig+300s, shuffled model trained to the label-variance plateau.
- The time-late failure is a training-budget effect, not evidence that the signal is absent.

### Major findings and responses

| # | Finding (reviewers) | Response |
| --- | --- | --- |
| M1 | Time-late fail is budget-limited (limit R3); "ML not extracting the signal" would overstate it. On post-zig validation rows (the scored rows) the epoch-23 BiLSTM loss is 0.406 vs the LSTM's 0.478 at epoch 23; the LSTM reached 0.405 only at epoch 31 (numerics, geometry, red team) | Accepted. Round-1 outcome is recorded as "G1 not passed as run: instantaneous variant met the criterion; time-late variant failed under a 25-epoch (wall-clock) budget and is plausibly undertrained; no evidence of absence of time-late signal". |
| M2 | Unequal budgets: the per-model wall cap gave time-late 25 epochs vs 60; a 6 h cap adds only ≈ 2 epochs (numerics, geometry, red team) | User decision 2026-10-12 (below): one equal-epoch continuation, pre-registered. |
| M3 | Rule 2 investigation of `time-late-not-worse` (numerics, statistics) | The investigation is the masking, alignment and causality checks above: no pipeline fault. The check fails because time-late is undertrained. |
| M4 | g1-limits S1 ("ask for a second training seed if a ratio is within ≈ 0.1 of 0.5") conflicts with decided rule 1 ("no re-training"); it was never marked superseded (statistics) | The later user-decided rules supersede S1; recorded in g1-limits.md and the briefs. No second seed for either variant. |
| M5 | No rule turns "undertrained" into "invalid"; any longer run needs an explicit amendment, decided after these results and recorded before the run (statistics, red team) | Done: SRD §5 amendment and the protocol below are committed before the continuation run starts. The 0.551 result stays recorded as a valid attempt. |

### Minor findings and responses

| Finding | Response |
| --- | --- |
| Model manifests carry no `git_commit`/`git_dirty` (reproducibility, red team) | Iteration 2 (schema). Provenance here: instantaneous, CNN, MLP, shuffled from run 38131616871 at 3c2f2c8; time-late from run 38152208243 at d9b71cf (training code identical) |
| Experiment manifest reads `git_commit` at write time but `git_dirty` at start (reproducibility) | Iteration 2 fix: capture both at start |
| FR-009: list every run, including the cancelled time-late job (run 38131616871, 5 h 15 min), smoke runs 38153046011/38154023864 and cancelled run 38165442543 (reproducibility, red team) | Listed in the iteration-1 blog post; none scored the test split |
| `tma-model-predict` cannot score the models on schema-0.5.0 data (red team) | Fixed in PR #27: optional `--train` |
| Time-late's loss weights pre-zig rows (51% of its rows, 64% of its loss), which are never scored (numerics, geometry) | Reported; not changed for the continuation (one change only). Candidate for iteration 2 |
| Per-band ratios: instantaneous/naive 0.11 (2–5 km), 0.59 (5–10 km), 0.50 (10–20 km); models show the prior's U-shape, classical scales with range (statistics, geometry) | Reported beside the instantaneous result in the blog post |
| Held-out 20–30 km: models look clamped to the training prior (instantaneous/naive 0.71; classical 0.188) (statistics, geometry) | Reported; G2 to include a range-extrapolation check |
| Shuffled model's course median 82.9° vs permutation null 89.7°: a weak bearing-as-course prior, not leakage (red team) | Reported; shuffled check to report course too (iteration 2) |
| Wall-clock budgets depend on runner CPU (red team) | Iteration 2 budgets in epochs |
| `g1Check` would pass if naive's median were non-finite (red team, note) | Cannot occur today (naive always converges); iteration 2 fix |
| `evaluate-g1.yml` picks the source folder by `ls \| sort` (reproducibility, note) | Iteration 2: explicit source folder |

## User decision (2026-10-12, after round 1)

Equal-epoch continuation of the time-late variant, pre-registered here and in SRD §5 before the
run starts:

1. **One change only:** `bilstm-time-late` continues from its committed epoch-23 weights
   (`weights_digest` 2c5f8784…, as in its manifest) with no wall-clock cap (`max_wall_s` 86,400), stopping
   at `max_epochs` 60 or early stopping (patience 3), exactly as the instantaneous model was
   allowed. Epoch 24 of the first run (worse than 23) is dropped; training resumes after epoch 23
   with the epoch-indexed batch order. Adam state restarts (logged).
2. **Unchanged:** data seed 101 and splits, `train_seed` 1002, architecture, loss weights,
   learning rate, batch size. The other four models are reused from run 38131616871 untouched; the
   instantaneous model is not retrained or reselected.
3. **Scoring:** the same `tma-g1` (tiered rule, paired bootstrap interval, decided rule 1 for an
   inconclusive result). The test split is not scored until training completes.
4. **Final:** a fail of the continued model is final for G1 (SRD §5 decision applies). No further
   continuation, seed or architecture change.
5. **Record:** this experiment (0.551) stays recorded as a valid attempt; the continuation is a new
   experiment folder reviewed by the panel.
