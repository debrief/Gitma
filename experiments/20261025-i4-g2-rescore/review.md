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
