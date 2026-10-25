# Iteration 4 G2 re-score on seed 206: run log and review

Decision: `../20261024-i4-rescore-decision/` (the aborted-run rule is in `decision.md`, "How it is
run"). Re-scored gate: `../20261024-i4-g2/`.

## Invocations

The command, at scoring commit 16f779a, with an 8 GB Node heap:

`tma-g2 --split test --plan configs/iter4/r/plan.json --decision experiments/20261024-i4-rescore-decision/decision.json --rescore-of experiments/20261024-i4-g2 --compare-models experiments/20261021-i3a-val/models --models experiments/20261023-i4a-val/models --data data/i4r --experiment experiments/20261025-i4-g2-rescore`

`--data data/i4r` is added to the decision's command text, which omits it (the default, `data/i2`,
holds no seed-206 data, and `requireRescore` refuses test data of any seed but 206).

- **Attempt 0** (2026-10-24 11:08 UTC). The wrapper shell could not exec `/usr/bin/time`, which this
  machine lacks. `tma-g2` never started and no experiment folder was created.
- **Attempt 1** (2026-10-24 11:09 UTC, node pid 25081): **aborted**, before `verdict.json`.
  - **What ran.** The marker was written at 11:09:25 (commit 0f1aaae). Naive predictions finished
    at 11:10 and classical per-timestep at 12:39. The BiLSTM (`bilstm-time-late`) started
    predicting at 12:39. Its temporary file had reached 538 MB when logging stopped at 13:15.
  - **Why it stopped.** The cloud container was reclaimed while the agent session was idle. The
    machine came back rebooted, with an uptime of 2 minutes at 16:14 UTC and no `tma-g2` process.
    The wrapper never wrote an exit status. This was not memory or disk: peak node RSS was
    594 MB against an 8 GB heap, and the lowest free disk was 17.1 GB.
  - **What was not seen.** No `verdict.json`, `metrics.json` or curves were written. No model
    figure was computed. Nobody opened the prediction files.

- **Attempt 1, the record.**
  - **Process IDs.** pid 25049 is the pnpm wrapper (`pid.txt`); 25081 is its node child.
  - **Commits.** The marker is commit 0f1aaae; it records git_commit 16f779a. This note was
    committed in 6d4a84c.
  - **Machine.** Intel Xeon Processor @ 2.30GHz, 4 CPUs, Node v22.22.0. TensorFlow logged the
    oneDNN flags AVX2 AVX512F AVX512_VNNI AVX512_BF16 AVX_VNNI AMX_TILE AMX_INT8 AMX_BF16 FMA. The
    reboot (`uptime -s` 2026-10-24 16:11:39) landed on the same CPU model and core count.
  - **Rates.** Classical took about 90 minutes and one model about 80 minutes or more. The whole
    run (five carried and five other-phase models, the other phase's feature builds) is expected
    to take about 12 hours or more.

## Repeat (decision.md aborted-run rule): request to the panel

The run is deterministic on frozen, digest-bound inputs, and attempt 1 produced no result, so a
repeat is not a second look. The repeat would run as follows.

1. **Remove the marker** `rescore.json` under this note, together with the partial predictions
   in `data/i4r/predictions`. Commit only this note and the marker's removal, so `git diff 16f779a
   HEAD -- packages scripts configs` stays empty.
2. **Re-run the same command** into this folder, from the clean tree at that commit. `tma-g2`
   writes a new marker.
3. **Keep the container alive** until `verdict.json` exists. The run is detached, and a
   harness-tracked waiter of at most 115 minutes is chained throughout, so the session is never
   idle while it runs.
4. **Count.** This is the one repeat the rule allows. If it also aborts, the panel decides again,
   and the record says so.

## Panel on the repeat (2026-10-24)

All five reviewers approve with findings: geometry, numerics, statistics, reproducibility and red
team. None rejects.

| Finding | Severity | Response |
| --- | --- | --- |
| **Red team.** Keep the partial BiLSTM file rather than deleting it, and show the repeat is byte-identical. | major | **Fixed.** The file is archived outside the repository, unread: gzipped in the session scratchpad, `rescore/attempt1/`. Its sha256 is recorded below. After the repeat, its first 537,741,633 bytes are compared with the repeat's BiLSTM file, and the naive and classical files must hash equal. The result is recorded in this file. |
| **Statistics.** "Nobody opened the prediction files" cannot be verified. | minor | **Answered.** No model figure could be derived. The BiLSTM never finished, the instantaneous LSTM (the model the gate turns on) never started, and the naive and classical files hold no model output. |
| **Statistics, numerics, reproducibility.** `test.features.bin` is not digest-checked by `tma-g2`. | minor | **Fixed.** `check-digests configs/iter4/r/plan.json data/i4r` passes after the reboot for all four packs, test seed 206 at [900000, 1000000). The sha256 of the features file and `norm.json` are recorded below and re-checked after the repeat. |
| **Statistics, geometry.** Delete the naive and classical files so every scored file comes from one run; hash them first. | minor | **Fixed.** Hashed (below), then deleted. |
| **Numerics, geometry, statistics.** Record pids, commits and hardware. | minor | **Fixed** (attempt 1, the record). |
| **Reproducibility.** Record the expected length, the chain of waiters and a clean start. | minor | **Fixed.** About 12 hours, roughly seven chained waiters. `git status` must be empty at launch; the marker is removed in its own commit before the run. |
| **Red team.** Count attempts plainly. | minor | **Fixed.** Attempt 0 never ran `tma-g2`. The repeat (attempt 2) is the only one. A second abort goes to the panel and is not retried. |
| **Geometry.** Keep the `--data` note and state that attempt 0 created no folder. | minor | Both are kept (Invocations). |

Attempt 1's files, sha256:

- `test.naive.ndjson` bf8e1b9a74340ab35a8d2b85a0e18fd6398353eefcae1a5819ff11624d1e69c2
- `test.classical.ndjson` 55c6b2cef1a01c1bfa265f299e1416f67e97b1ecf98c2bc7887ed9caae6b4b23
- `test.bilstm-time-late.ndjson.tmp-25081` (537,741,633 bytes, partial)
  60254cb4ba6e496527a25378052684b9e43d8e11540983dc16991bea2e723fbe

Inputs, sha256 (before the repeat):

- `data/i4r/test.features.bin` fed5ed05beaea42aba11cc50637ae3dc8de69f84f112c5206727bf7ad77b6f8d
- `data/i4r/norm.json` 55fa04196bfd1b1ba68be0cba55ee68467e6d3e494caf91fe9ceb586989b7903

## Attempt 2 (2026-10-24 16:22 UTC, commit db01efe, node pid 974): aborted again

- **What ran.** The marker is commit 9fa98d7.
  - **Identity check.** Naive, classical and the BiLSTM's first 537,741,633 bytes hash equal to
    attempt 1's (red team's check passed).
  - **Carried and control sets.** All five iteration-4 models were predicted, and their
    `metrics.json`, `curves.csv`, `metrics.csv`, `bootstrap.json` and comparison files were
    written (19:10–19:19 UTC).
  - **Other phase.** Two iteration-3 models were predicted before 20:12; the third
    (`lstm-instantaneous`) was predicting when logging stopped at 20:17.
- **Why it stopped.** The container was reclaimed again. The waiter had ended at 20:12, then the
  session's worker restarted, and the machine was rebooted at about 20:50. Peak node RSS was
  2.73 GB; the lowest free disk was 6.0 GB.
- **No verdict.** `verdict.json` is written last and does not exist.
- **The written metrics were not read.** They were hashed (below), copied unread to the session
  scratchpad, and deleted with the predictions, so attempt 3 starts clean. Attempt 3's files must
  hash equal.
- **The owner said "Try again" (2026-10-24 20:50 UTC).** The rule in the panel round above sends
  a second abort to the panel. The owner's instruction is recorded here, and the retry goes to
  the panel with the result. The retry cannot fish for a pass: every input is bound by digest, the
  code is unchanged (`git diff 16f779a HEAD -- packages scripts configs` is empty), the scoring
  is shown deterministic, and attempt 3's outputs are compared byte for byte with attempt 2's.
- **The marker** `rescore.json` (9fa98d7) is removed under this note.

Attempt 2's experiment files, sha256:

```
f38ec8aa4a8ec388429660006d4c7cd903560d9c3b36e60399595487ad790595  bootstrap.json
a2e8e4a19dbbf0f6f70479f1fc8b352aee091088a1647c771823ddfe548c75b6  comparison.csv
bd4e8967adfa5924cd72703f66412d529b628a89986bfd7e37244004e23ebb38  comparison.json
e8e64e162ebed9c0fa162a6f9cd25b63c8738f4e7d90bfe6324017388f9d72fb  curves.csv
23d6ab0db698764d55b9a1e0465d4c3faec360af04f46cb7952550d20144b71f  metrics.csv
640ad4ba8c626129179216a2bb12938fb00f37ea07eea4405d0d898feb6cecad  metrics.json
c55a324a419d4a9380628f8214db492f210b50bd744c0de34fd6b2e608098e46  models/bilstm-time-late/manifest.json
6a8810cbb1a6482b86466a9bf66731b5c5acfa79040a7e8293f298327321fb3f  models/bilstm-time-late/model.json
71fcb706872943410355db3c493eab171cbdbfe2fee59472d306937d23f562a8  models/bilstm-time-late/weights.bin
4b9bb75c181e6421ff9cb1099720f8418d54f995e04cf47f9e725a137b25b75f  models/cnn-causal-control/manifest.json
a0b6d9c58555482247a884c51926960fa47043bd68018e5350359dac7c32dd43  models/cnn-causal-control/model.json
b4f4cde209441820b454448a6f5af3fb12305ed2d079d4bdbd368161212afb23  models/cnn-causal-control/weights.bin
f45ee74cac5b41a1739be52ccc02104851e0f7530894ed186428cdecd87c9428  models/lstm-instantaneous-shuffled/manifest.json
4224e22bd8f487dd5f30dffcf4cb4f46f19518924ce3cc0ae0753a496eb205b9  models/lstm-instantaneous-shuffled/model.json
0bfc5e87bf45c5360636c69753a1cb69a580feb6807a8dc1ca2c07d36aff8a5b  models/lstm-instantaneous-shuffled/weights.bin
4cec98b4e9d95042015aabbd81345027c7ad81e05757fb5cf76ca29ef1a88580  models/lstm-instantaneous/manifest.json
78b9e12bb7096e65b927b204dc5fe7eeb4483e4a454df86c32fcc0a27101ed61  models/lstm-instantaneous/model.json
495e250230d4ad69b44317e03c74fd3dbbc75b76758e65147919e2230adbf9f2  models/lstm-instantaneous/weights.bin
b82fe29de30367cc1fe7b19296c3491f2900522868ab2df763942ce70236ff7e  models/mlp-control/manifest.json
92ace27bc158594feb9e5213a48b333b7a1d3c8d9dfc6de24399547faa3d4717  models/mlp-control/model.json
589be566b998a558739258fd780e291d51132f7cb6beadd4cdaedcbbfb58968f  models/mlp-control/weights.bin
```

Attempt 2's completed prediction files, sha256:

```
35d332943d630a2f2ec423038f130d0de2e49d9a5a97f5156d491870484c0ad7  test.bilstm-time-late.ndjson
55c6b2cef1a01c1bfa265f299e1416f67e97b1ecf98c2bc7887ed9caae6b4b23  test.classical.ndjson
98784f634539843b9231ce41eff4e3ad811b41e25972049386c8f7044dbd4da8  test.cnn-causal-control.ndjson
701df25a47a9a818aa26c02baf77eac81bdee1618c9c0e3920d297bfe3b93494  test.lstm-instantaneous-shuffled.ndjson
3049e6032493b8eeb9ce7bfc350d2389b70236cfd68db66a4abace841a420cc2  test.lstm-instantaneous.ndjson
8aef26dd4d0b0d99daa4b61c1a8f1565f23224bf8074bb6441386149f2078203  test.mlp-control.ndjson
bf8e1b9a74340ab35a8d2b85a0e18fd6398353eefcae1a5819ff11624d1e69c2  test.naive.ndjson
97028ed1853832693aedc3e0eff888592fd6717c3d52bd1a77e3f9b4e1b26d3b  test.other-phase.bilstm-time-late.ndjson
f85572fcb61bd62ba415e03a0ccf208d0a95af59e63b0f241c7568a4b0006569  test.other-phase.cnn-causal-control.ndjson
bf8e1b9a74340ab35a8d2b85a0e18fd6398353eefcae1a5819ff11624d1e69c2  test.other-phase.naive.ndjson
```

## Attempt 3 (2026-10-24 20:58 UTC, commit 0defa26, node pid 461): aborted again

- **What ran.** The marker is commit e4f9d6a.
  - **Carried and control sets.** All five iteration-4 models were predicted, and their
    evaluation files were written. Each of those files hashes identical to attempt 2's.
  - **Other phase.** Three iteration-3 models were predicted. The fourth
    (`lstm-instantaneous-shuffled`) had a 403 MB temporary file when logging stopped at 01:28.
  - **Identity.** All ten prediction files that both attempts completed hash identical.
- **Why it stopped.** The container was reclaimed with a waiter running. The machine was
  rebooted at about 01:29. Peak node RSS was 2.19 GB; the lowest free disk was 4.7 GB.
- **No verdict.** Neither attempt has written `verdict.json`.
- **Container lifetime is the cause.** Containers lived about 4.1–4.6 hours (16:11–20:17 and
  20:50–01:28), and a full run takes about 4.5–5.3 hours. Repeating it unchanged is likely to
  abort again.
- **The owner's choice (2026-10-25).** The owner chose "resume tooling". Attempt 4 reuses the
  completed prediction files rather than predicting them a third time.

### Attempt 4: resume from verified predictions (tooling change, for the panel)

`tma-g2 --reuse-predictions <file>` works as follows.

- **Mode and file.** It is accepted only in re-score mode, from a committed file, `reuse.json`
  in this folder.
- **What the file holds.** It maps each prediction file name in `data/i4r/predictions` to its
  SHA-256.
- **What is reused.** A listed file is reused only after its SHA-256 is verified.
- **What is refused.** A listed file that is missing, differs or goes unused.
- **The record.** The manifest notes name every reused file.
- **Everything else** is unchanged and predicted as usual.

`reuse.json` lists the ten files that attempts 2 and 3 both completed with identical SHA-256.

- **Predicted again** (three files):
  - `test.other-phase.lstm-instantaneous.ndjson`, which attempt 3 alone completed (sha256
    c3b78da89db867808fc68787fe72e5796abc9b571157b0c9e6c8180d39b10970). It is re-predicted and
    must hash equal to that value.
  - `test.other-phase.lstm-instantaneous-shuffled.ndjson`.
  - `test.other-phase.mlp-control.ndjson`.
- **Deleted before the run:** attempt 3's partial and cache files and the evaluation files in
  this folder. The evaluation files must hash equal to attempt 2's.
- **Expected run time:** about 2.5 hours, inside one container's life.
- **Code diff.** `git diff 16f779a <attempt-4 commit> -- packages scripts configs` shows only
  `packages/models/src/{g2,cli-g2}.ts` and the test.
- **Gate checks unchanged.** No check or threshold changes, and nothing in the verdict's
  computation changes.
- **The marker** `rescore.json` (e4f9d6a) is removed under this note.

### Panel on attempt 4 (2026-10-25): all five approve with findings, none rejects

| Finding | Severity | Response |
| --- | --- | --- |
| **Red team.** The post-review edits (estimator check) were uncommitted. Commit them and record the scoring commit's diff. | major | **Fixed.** The changes are committed with this note. `git diff 16f779a <scoring commit> -- packages scripts configs` touches only `packages/models/src/{g2,cli-g2}.ts` and `packages/models/test/g2.test.ts`. The run starts from a clean tree. |
| **Geometry.** Check a reused file's header estimator against the model id. | minor | **Fixed.** A mismatch is refused (tested by copying one model's predictions under another's name). |
| **Numerics.** The fallback `features === undefined` would open an unverified file. | minor | **Fixed.** Only a verified reuse skips prediction; missing inputs throw. |
| **Reproducibility.** The reused other-phase note said its inputs were built. | minor | **Fixed.** It now reads "reused prediction; its inputs were not rebuilt". |
| **Statistics, geometry, numerics, reproducibility.** Say whether anyone read attempt 2's `metrics.json` and `bootstrap.json`. | minor | **Answered.** Nobody read them. They were copied to the scratchpad only so they could be hashed. Those copies are now deleted, and their hashes stay above. No model figure from any attempt has been seen. The result will be reported and finished, whatever it is. |
| **Statistics.** Pre-register what happens on a mismatch. | minor | **Pre-registered.** If attempt 4's evaluation files do not hash equal to attempt 2's, or the re-predicted `test.other-phase.lstm-instantaneous.ndjson` is not c3b78da8…, the verdict is void and the run returns to the panel. |
| **Statistics.** Attempt 3 was a second repeat, directed by the owner. | minor | **Recorded** as a deviation from the decision's one-repeat rule. This panel ratifies it: the outputs are deterministic and unread, and attempt 3 reproduced attempt 2 byte for byte. |
| **Reproducibility.** The recompute checks are manual. | minor | Both comparisons are recorded here after the run. |
| **Numerics.** Record the CPU of each attempt. | minor | **Recorded.** Attempt 1 ran on an Intel Xeon Processor @ 2.30GHz; attempt 4 runs on one @ 2.80GHz, 4 CPUs. The CPUs of attempts 2 and 3 were not logged; TensorFlow logged the same oneDNN flags in every attempt. All agree byte for byte. |
| **Red team.** Naive and classical are bound by hash only. | minor | Accepted, since the hashes come from two identical attempts. |
| **Red team.** An unused list entry is reported only at the end of the run. | minor | Accepted. Every entry is used in this run, as the panel's hash checks confirm. |

## Attempt 4 (2026-10-25 08:33–12:12 UTC, commit 9c2344d, marker c91b283): complete

- **Run.** Exit 0, and `verdict.json` was written last. Peak node RSS was 2.90 GB; the lowest free
  disk was 2.4 GB. The log is in `run-log.txt`.
- **Reuse.** The ten files in `reuse.json` were reused with their sha256 verified. The manifest
  notes name each one. The other three were predicted:
  - `test.other-phase.lstm-instantaneous.ndjson` is c3b78da8…, equal to attempt 3's, as
    pre-registered.
  - `test.other-phase.lstm-instantaneous-shuffled.ndjson` is 6295d4fd3c3d616b224c9758a3cc04e622ed579e6c9b806b53558767a6c9bc38
    (single attempt).
  - `test.other-phase.mlp-control.ndjson` is 6c608c27d55e664030b4ab5bd7bfe320bc4dc24b5eab4ff1ac274a31b32e0d96
    (single attempt).
- **Identity.** All 21 carried-set evaluation files (`metrics.json`, `bootstrap.json`, curves,
  comparison and `models/`) hash identical to attempt 2's, as pre-registered. The result is
  attempt 2's, unread until now.

### Result: G2 **pass** (`tma-g2`), pending the panel

σ = 1° slice. Range and course are taken at zig + 300 s (n 49,574, 500 excluded, 99.0% reach that
point). Speed is taken at zig + 600 s (n 32,266, 17,808 excluded, 64.4% reach). Each model figure
has a 95% bootstrap interval (2,000 resamples, seed 20261011).

| Check (threshold) | Model | Naive | Classical | |
| --- | --- | --- | --- | --- |
| instantaneous range (< 20%) | 7.26% [7.19, 7.34] | 39.9% | 3.40% | pass |
| instantaneous course (< 10°) | 4.70° [4.64, 4.77] | 89.8° | 1.36° | pass |
| **instantaneous speed (< 1 kt)** | **0.939 kt [0.926, 0.951]** | 4.23 kt | 0.319 kt | **pass** |
| time-late range | 5.30% [5.24, 5.36] | 39.9% | 3.40% | pass |
| time-late course | 3.13° [3.09, 3.17] | 89.8° | 1.36° | pass |
| time-late speed | 0.740 kt [0.731, 0.751] | 4.23 kt | 0.319 kt | pass |
| G1 model / naive range | 0.207 [0.205, 0.209] and 0.152 [0.150, 0.153] | | | pass |
| time-late not worse | all 21 curve points | | | pass |
| shuffled labels at naive | 0.984 × naive | | | pass |
| controls beaten (reported) | CNN 0.158, MLP 0.134 against 0.083 / 0.061 | | | pass |

**Paired ratios** (95% intervals):

| Model | vs | Range | Course | Speed |
| --- | --- | --- | --- | --- |
| LSTM | classical | 2.14 [2.10, 2.17] | 3.45 [3.39, 3.52] | 2.95 [2.89, 3.02] |
| LSTM | iteration-3 LSTM | 0.83 [0.82, 0.84] | 0.75 [0.74, 0.77] | 0.84 [0.82, 0.85] |
| BiLSTM | classical | 1.56 [1.53, 1.59] | 2.30 [2.25, 2.34] | 2.32 [2.28, 2.38] |
| BiLSTM | iteration-3 BiLSTM | 0.74 [0.73, 0.75] | 0.73 [0.72, 0.74] | 0.74 [0.73, 0.75] |

**The iteration-3 models beside them** (reported only):

- range 8.7% / 7.2%;
- course 6.24° / 4.31°;
- speed 1.124 / 1.004 kt.

**Bias against the forecast.** Computed after the run (post hoc, reported only) with
`scripts/research/spec008-rescore-bias.mjs` at zig + 600 s, σ = 1°:

| Model | Median signed error | Slope of predicted on true speed | Forecast |
| --- | --- | --- | --- |
| LSTM | −0.334 kt | 0.883 | about −0.4 kt and 0.88 |
| BiLSTM | +0.083 kt | 0.926 | — |
| classical | +0.004 kt | 0.986 | — |

- **By speed band.** The LSTM's median signed error is −1.42 kt for 17.5–20 kt targets and
  −0.53 kt at 15–17.5 kt.
- **Reading.** The bias reappeared as forecast, so the scored model is the gate's model.

**Against the forecast and seed 205.** The seed-205 test figure was 0.981 kt [0.940, 1.031], and
seed 205's validation was 0.94 [0.91, 0.98].

- The seed-206 point, 0.939, lies 1.9 seed-205 standard errors below the seed-205 test point.
- It is just below that test interval (lower bound 0.9405), and it equals the validation point.
- The pre-registered chance of a pass, from a prior centred on the seed-205 test figure
  (0.981 ± 0.022), was about 0.55.
- **Not pooled.** Both results are reported, as pre-registered.

## Panel on the result (round 1, 2026-10-25): all five approve, none rejects

| Reviewer | Verdict | Independent check |
| --- | --- | --- |
| TMA geometry | **approve** | Recomputed every gate figure from truth and predictions. The bias by band matches the frozen model (18–20 kt: −1.51 kt against −1.50 on seed 205). The models never beat classical in any bin. |
| Estimation and numerics | approve-with-findings | Recomputed 0.9394 kt, n 32,266, and the interval [0.9255, 0.9512] with the repo's bootstrap. Hand-decoded 21,712 rows: differences are float32 rounding only. Classical is at the Cramér–Rao bound. |
| Evaluation statistics | approve-with-findings | Recomputed with 4,000 resamples and an exact order-statistic interval: [0.9257, 0.9514]. The upper bound is 7 SE below the threshold. Two looks raise the false-pass rate at the threshold to about 3.7%, as pre-registered; the aborts add no look. |
| Reproducibility | approve-with-findings | Re-ran `tma-eval` and `tma-gate g2` on the prediction files. `metrics.json`, `metrics.csv`, `curves.csv`, `bootstrap.json` and `verdict.json` are byte-identical. It also checked the model and plan digests and all identity claims. |
| Red team | approve-with-findings | Own recompute matches. The data, seeds and models are right. The reused files are genuine. The abort history caused no selection: attempt 2's hashes were committed before "Try again", and the result equals them. |

No blocker or major findings. Responses to the minors:

| Finding | Response |
| --- | --- |
| **Red team.** 0.939 is not inside the seed-205 interval. | **Fixed.** The text now says it is just below it (lower bound 0.9405). |
| **Red team.** P(pass) 1.00 at the observed median is circular. | **Fixed.** Removed; the pre-registered 0.55 stays. |
| **Red team, statistics.** Explain the seed-205 to seed-206 difference. | **Answered.** The difference is 0.042 kt, z ≈ 1.8, two-sided p ≈ 0.07. Weighting seed 206 to seed 205's mix of speed and range gives 0.945, so the mix explains about 0.006 kt (geometry). The rest is chance: seed 205's test draw was high, and its validation was 0.94. The results are not pooled; pooling would give about 0.943. |
| **Statistics.** Report P90. | **Added** (below). |
| **Numerics, statistics, red team.** Keep the context: a narrow pass, about 3 × classical. | **Agreed.** 52.6% of the LSTM's speed rows are under 1 kt. Removing the bias by speed and range would still leave 0.86 kt; the rest is scatter. The models are 2.3–3.0 × classical on speed and up to 13 × at short range. G2 is useful; G3 (classical parity) is far off. |
| **Geometry.** Accuracy at short range. | **Added.** The LSTM is 0.97 kt under 2 km (n 816), against 0.72–0.78 kt at 2–8 km. Near closest approach the bearing rate changes fast and the 3-minute trailing rate lags it. |
| **Geometry.** Phase split. | **Added.** At zig + 600 s, 32,228 of the 32,266 speed rows are in leg 3 and 38 are in the second turn. At zig + 300 s the rows are mostly in the second turn. |
| **Numerics.** The fourth output is not zero. | It reaches about |0.82|. It carries no loss and decoding never reads it, so it has no effect. This goes in the algorithm note with the write-up. |
| **Reproducibility.** The bias script came after the run. | **Labelled** post hoc and reported only. |
| **Reproducibility.** `comparison.*` not re-run. | They equal attempt 2's (among the 21 files), and the verdict does not read them. |
| **Reproducibility.** "Unread" cannot be verified. | Agreed. The outcome is fixed by deterministic, digest-bound inputs either way. |

**P90 at the gate points** (σ = 1°; range and course at zig + 300 s, speed at zig + 600 s):

| Estimator | Range P50 / P90 | Course P50 / P90 | Speed P50 / P90 |
| --- | --- | --- | --- |
| LSTM (instantaneous) | 7.26% / 20.5% | 4.70° / 23.1° | 0.939 / 2.91 kt |
| BiLSTM (time-late) | 5.30% / 14.5% | 3.13° / 14.5° | 0.740 / 2.34 kt |
| classical | 3.40% / 14.8% | 1.36° / 17.8° | 0.319 / 1.89 kt |
| naive | 39.9% / 156% | 89.8° / 162° | 4.23 / 7.65 kt |

**Decision: G2 PASS** on the seed-206 re-score (SRD §7). It is decided by the agent review panel,
round 1 on the result: no rejections, no open blocker or major findings.
