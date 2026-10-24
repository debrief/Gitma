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
