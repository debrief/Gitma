# G7 review (phase 6, spec 018, decision 33)

The machine verdict on seed 215 is **inconclusive**.
- **The one inconclusive check.** Fused log-range 50% coverage is 48.32% [47.81, 48.82], against a
  band of 48–52%.
- **The other eight gated checks pass.** Coverage is within nominal ± 2 pp, and the median 90%
  widths are 0.734 / 0.945 / 0.891 of the IMM's.

## Round 1 (five independent reviewers, read-only)

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 3 | 2 |
| Estimation and numerics | approve-with-findings | 0 | 2 | 4 |
| Evaluation statistics | approve-with-findings | 0 | 1 | 4 |
| Reproducibility | approve-with-findings | 0 | 0 | 3 |
| Red team | approve-with-findings | 0 | 3 | 6 |

All five agree that "inconclusive" is the correct reading under §C.13. The reproducibility reviewer
re-ran the gate from the record:
- `verdict.json` is byte-identical, and `scoring.json` differs only by `repeat_of`;
- all hashes and plan digests verify;
- the data come from a clean tree at a direct child of decision 33's commit;
- `dist/` matches the source.

### Major findings and responses

| # | Finding (reviewers) | Response |
| --- | --- | --- |
| M1 | **Coverage is marginal only; within regimes it is far off.** For example, fused log-range 50% is 60.9% at zig + 5 min and 39.6% at zig + 20 min; course 50% is 75.8% settled and 30.4% unsettled. The IMM shows the same pattern. (geometry, estimation, statistics, red team) | **Agreed. Reported, and the claim is narrowed.** `regimes.json` (from `scripts/research/spec018-regimes.mjs`) gives coverage by settled/unsettled, before/after any manoeuvre and gate time, for both trackers. Every write-up says the intervals are calibrated **on the pooled G5 row mix only**: too wide on quiet straight legs, too narrow after manoeuvres. One multiplier per output cannot fix their shape. This was stated in advance as a limit in decision 33. |
| M2 | **Many course intervals are vacuous.** 17.0% of fused rows (IMM 19.9%) have a 90% half-width of 180° or more and are covered automatically; without them, fused course-90 is 88.5%. The median course width is 189°, and speed's 90% lower bound is below 0 on 27% of rows. (geometry, red team) | **Agreed. Reported** in `regimes.json`: `vacuous_90_share`, `coverage_90_without_vacuous` and `negative_lower_90_share`. The course width ratio (0.945) compares two mostly uninformative intervals. Course and speed intervals are described as uninformative on many rows, and the delta method is not valid at a 57° sd. The gate rule is not changed after scoring. |
| M3 | **The shortfall is systematic, not noise.** It is 1.68 pp, about 3 SE, against 0.46 pp for the IMM. A plausible mechanism: T2's best epoch and the fusion's k and M were chosen on the same seed-211 validation split the multipliers were fitted on, so they are optimistic on fresh data. (statistics, estimation) | **Agreed; recorded as the likely mechanism.** A re-score would probably centre near 48.3% again. Its outcome would show only whether coverage reaches the floor, not that the tracker is well calibrated. The owner decides whether to re-score (below). |
| M4 | **Coverage by regime was promised but not reported.** (red team) | **Fixed:** `regimes.json` is committed. |
| M5 | **The owner had no real chance to amend the agent-written rules.** §C.13 and decision 33 were committed two minutes apart, after validation was seen. (red team) | **Agreed.** The ±2 pp tolerance, the median-only width and the 95% level were set by the agent. They are not obviously self-serving: the tolerance is symmetric and the validation result was within it on every check. But the owner did not review them before decision 33. This is disclosed, and the owner is asked now, before any re-score, whether to keep these rules for it. |

### Minor findings and responses

- **The forecast named the wrong weak check.** It said speed-50; the miss was log-range-50.
  Recorded.
- **The two-fold check could not resolve a 1.5 pp shift**, since half splits give intervals of
  about ±1.4 pp. Recorded.
- **Multiplier sampling error** (about 0.5 pp) is not in the coverage CI, as pre-registered. Stated.
- **P90 widths** are now reported. The fused tracker is narrower than the IMM at the 90th
  percentile too: log-range 0.812 against 1.296, course 473° against 524°, speed 32.2 against
  36.7 kt.
- **Baselines.** The EKF has no `-sd`, and naive has no uncertainty, so the IMM is the only
  uncertainty baseline. Stated.
- **`run.sh`'s final line** now matches `predictions.sha256` (it adds `test.features.bin`). The
  gate's memory need, 10–12 GB free, is noted in `run.sh`.
- **The fail test uses `<`, not `≤`.** It cannot matter here and is left unchanged after scoring.
- **The re-computed sample is predictable** (inherited from spec 015); this is a known limit.
- **All nine checks share one bootstrap seed.** This is harmless and stated.
- **`decided_by`** is set once the panel approves.
