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
