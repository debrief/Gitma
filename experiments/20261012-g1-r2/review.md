# G1 agent panel review: the time-late continuation (round 3)

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open. Brief: "Round 3 — the time-late continuation"
in `specs/002-iteration-1-signal/g1-panel-briefs.md`. Attempt 1 and rounds 1–2, including the
pre-registered continuation protocol: [`../20261011-g1-r2/review.md`](../20261011-g1-r2/review.md).
Attempt 1 (time-late 0.551, fail) stays recorded as a valid attempt.

**Verdict of record:** this folder, re-scored by `evaluate-g1.yml` run 38275763335 on main code
(commit bb4525b = main 1a44652 plus the experiment folder). `../20261012-g1/` is the training run's
own folder (train/i1 code, no bootstrap; its `verdict.json` reads `fail`) and is **informational
only**.

| Check | Machine result | Detail |
| --- | --- | --- |
| g1-instantaneous | pass | lstm-instantaneous / naive 0.419, 95% CI [0.407, 0.431] |
| g1-time-late | pass | bilstm-time-late / naive 0.450, 95% CI [0.438, 0.464] |
| time-late-not-worse | fail | time-late worse than 1.05 × instantaneous at 14/20 gated points |
| instantaneous-beats-control | pass | 0.161 vs CNN 0.293 (zig+300s) |
| time-late-beats-control | pass | 0.173 vs MLP 0.263 (zig+300s) |
| shuffled-labels-at-naive | pass | 1.005 × naive |

Machine verdict `inconclusive` (tiered rule 2, from `time-late-not-worse`). `verdict.json` is left
exactly as the code wrote it.

## The continuation as run (protocol point 5)

Run 38208186337, branch `train/i1-continue`, commit 7c1c579. The seed step checked weights
2c5f8784… and a config differing from attempt 1 only in `max_wall_s` (19,800 → 86,400).

| Attempt | Job id | Job | Epochs | CPU | Outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | 114676255384 | plan | – | – | success |
| 1 | 114676289268 | train (time-late) | 24–41; seeded from epoch 23; Adam restarts once, patience grace 24–26 | AMD EPYC 7763 | 345-min step timeout; last checkpoint at epoch 41 |
| 1 | 114785366608 | g1 | – | – | failed before scoring ("no trained time-late"); test split untouched |
| 2 | 114789157629 | train (time-late) | 42–49; resumed with optimizer state restored | Intel Xeon Platinum 8573C | early stopping, best epoch 46 (val 0.4408) |
| 2 | 114832540726 | g1 | – | – | success (informational folder `../20261012-g1/`) |

Epochs 0–23 ran in attempt 1 (run 38152208243, AMD EPYC 9V74). Training crossed three CPU
families, so a retrain will not reproduce weights c52b628c… byte for byte. The committed weights
are the artefact of record, and re-scoring them is deterministic. Extracted job log lines are in
`../20261012-g1/training-logs/`; full logs come from
`gh api repos/debrief/Gitma/actions/jobs/<id>/logs`, not `gh run view --log --job`, which returned
the other attempt's log.

The four reused models are byte-identical to attempt 1 (all three files each). Their metrics
differ from attempt 1's re-score by at most 8.4e-6 relative. This is float32 inference on
different instruction sets: run 38182021648 ran on AVX2 and run 38275763335 on AVX-512. A local
AVX-512 re-score reproduced this folder byte for byte. Naive and classical rows are identical.

## Round 3 (2026-10-12)

| Reviewer | Verdict |
| --- | --- |
| TMA geometry | approve-with-findings |
| Estimation and numerics | approve-with-findings |
| Evaluation statistics (independent paired bootstrap: time-late [0.4377, 0.4649], instantaneous [0.4074, 0.4313]) | approve-with-findings |
| Reproducibility (local re-score at bb4525b: `verdict.json`, `bootstrap.json`, metrics, curves and held-out byte-identical) | approve-with-findings |
| Red team (no protocol deviation, leakage or selection between attempts; one continuation and one re-score) | approve-with-findings |

All five say the evidence supports **G1 pass under pre-registered rule 1**.

### Major finding and response

| # | Finding (reviewer) | Response |
| --- | --- | --- |
| M1 | The SRD §5 G1 row still read "a time-late consistency failure makes it inconclusive", and its 2026-10-12 amendment did not carry rule 1's "pass even if `time-late-not-worse` fails". AGENTS.md makes the SRD win conflicts. Round 1's explanation of the consistency failure (M3: undertrained) no longer covers a model trained to early stopping (red team; geometry finding 2 agrees). | SRD §5 G1 row amended to carry rule 1 as decided by the user on 2026-10-12 before the run, so SRD and protocol agree. Rule 1 was committed in 4e17056 (05:29:44Z), before the run was triggered (05:29:59Z) and before the test split was scored (13:25Z). The round-1 explanation is withdrawn for this model: the consistency failure is **not** explained by undertraining (see the caveat below). |

### Minor findings and responses

| Finding (reviewers) | Response |
| --- | --- |
| "Not shown better" understates it; time-late is measurably worse (statistics, geometry, red team) | Caveat states the gap (below) |
| Epoch-48 spike in train and validation loss (numerics, red team) | A training instability, not a resume artefact. The instantaneous model, never resumed, had one at epoch 40. Scored weights are epoch 46, before it. It ended training by patience at 50 epochs (instantaneous ran 60), so "equal epoch budget" was 50 vs 60 in effect. Gradient clipping is an iteration-2 candidate |
| Resume test covers the single LSTM only; a Bidirectional positional slot swap would go unnoticed (numerics) | The reviewer ran a cross-process Bidirectional resume: byte-identical weights, and a missing-state control differs. A cross-process Bidirectional test is added in iteration 2 |
| Per-job record not committed; logs lacked job ids (reproducibility) | Table above; job ids added to the extracted log headers |
| Manifest names only the last job's CPU (reproducibility) | Both CPUs recorded above |
| Re-scored manifests carry no `cpu_model` (statistics, reproducibility) | Iteration 2: `evaluate-g1.yml` prints `lscpu` and records the CPU |
| One training draw per variant; seed variance unquantified (statistics) | Stated in the caveat; g1-limits S1 stays superseded |
| Blog draft still has `TODO(continuation)` (statistics) | Filled before this record merges |

## Decision

**G1 passes** under pre-registered rule 1 (SRD §5 as amended 2026-10-12). Both ratio intervals
lie wholly below 0.5 (time-late's upper bound is 0.036 below it, about 7 bootstrap standard
errors), and the shuffled-label model sits at naive. The machine verdict is `inconclusive`, from
the consistency check; the pass is the panel's application of rule 1.

**Caveat, recorded with the pass:**

- **Time-late not shown better than instantaneous.** It is measurably worse: at zig+300s,
  0.173 vs 0.161, a ratio of 1.075 [1.046, 1.108]. It is worse by 5–9% at the 14 gated points
  from 120 to 900 s, and better only at zig+60s.
- **Not explained by undertraining.** The continued model trained to early stopping.
- **The BiLSTM under-uses the future.** Its error profile is shaped like a causal estimator's.
  Masking and the backward pass are verified correct, and truncating the future does change
  outputs, but weakly.
- **Iteration-2 leads:**
  - Pre-zig rows carry 64% of time-late's loss but are never scored.
  - Gradient clipping.
  - Both models still follow the training prior by range band, and are clamped on the held-out
    20–30 km set.
- **One training draw per variant.** Training-seed variance is unquantified.
