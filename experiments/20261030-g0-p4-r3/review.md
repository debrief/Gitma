# G0 on generator 0.5.0 (phase 4): agent review panel

Gate G0 for generator 0.5.0 (spec 012 T005; SRD Annex C §C.2). Five independent read-only reviewers,
one per speciality (AGENTS.md, constitution 1.3.0).

- **Round 0** (`../20261030-g0-p4-r0/`, code 5794d6c): the harness **failed** two tracker checks.
  - `tracker-noise-free`: median 2.15e-2 after the last manoeuvre over all mixes, against a 1e-2
    limit set in phase 3 on one turn.
  - `tracker-noisy-sanity`: ratio of medians 1.261, against a 1.25 limit.
- **Round 1** (`../20261030-g0-p4-r1/`, code b2ebed3, same data): the harness passed after both
  checks were re-scoped. The re-scoping was **post hoc**: decided after seeing round 0's failures,
  on the same sample. The panel reviewed it.
- **Round 2** (`../20261030-g0-p4-r2/`, code bddde0f, same data): the harness passes every check,
  including a new one, `tracker-nis`. `distribution.json` is the realised distribution that
  Annex C §C.2 requires.
- **Round 3** (this folder, code 93febf5, same data): the harness passes every check, after the
  round-2 minor fixes. `distribution.json` is byte-identical to round 2's.

Data: `tma-generate --seed 42 --count 100000 --noise-free --ranges configs/phase4-ranges.json
--heldout-ranges configs/phase4-heldout-ranges.json`, generated at 5794d6c. The generator has not
changed since; only checks have. The content digest of every split is in `distribution.json`.

## Round 1

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 0 | 6 |
| Estimation and numerics | approve-with-findings | 0 | 0 | 4 |
| Evaluation statistics | approve-with-findings | 0 | 3 | 4 |
| Reproducibility | approve-with-findings | 0 | 0 | 4 |
| Red team | approve-with-findings | 0 | 1 | 6 |

None rejected.

**Reproducibility.** The reproducibility reviewer regenerated the data at 5794d6c and re-ran
`tma-g0` at e6e144d. The data digests, `verdict.json`, `metrics.json` and `metrics.csv` matched
byte for byte. Older ranges (iterations 2–4 and phase 3) still produce identical scenarios, and the
golden diffs are version strings only.

**Mutation testing.** The geometry and red-team reviewers mutated generated 0.5.0 scenarios, and
the kinematics, span and atan2 checks caught every mutation on every applicable scenario:
- an arc mirrored, or flown at the wrong rate (× 1.02);
- acceleration × 1.02 or × 1.1;
- speed or course stored but not flown;
- motion one sample late;
- spans shifted by ±1;
- overlapping manoeuvres;
- a manoeuvre dropped;
- the track rotated after a turn;
- bearings from the wrong track.

The numerics reviewer integrated the target independently, with 0.05 s midpoint steps split at
each manoeuvre: it matched to 2.1 mm in position, 2 µrad in course and 2 µm/s in speed.

### Major findings and responses

**S1 (statistics). The cap's rationale was wrong: round 0's noisy-check failure was mostly
sampling noise.**
- Seed 20261028's ratio has a paired-bootstrap interval of [0.98, 1.64]. On seven other seeds the
  ratio is 0.93–1.23. Pooled over 1,600 scenarios, capped and uncapped are the same (1.105 and
  1.107).
- The numerics reviewer adds that the 1.26 comes from comparing two medians: the paired
  per-scenario median ratio is 1.05 both capped and uncapped. The small long-stretch excess comes
  from mixing in the coordinated-turn model (switch 0 gives 1.03), not from drift.
- _Response: fixed._
  - The cap is removed.
  - For 0.5.0 ranges the check is the median per-scenario ratio, over 1,000 scenarios, at the last
    sample before the first manoeuvre (as phase 3), with batch least squares fitted on the same
    samples. It gives 1.054 against a 1.25 limit. The ratio of medians (1.174) is reported.
  - The wrong comment is replaced.
  - The 0.4.0 path is unchanged, so phase 3's committed G0 still reproduces.

**S2 (statistics). "Settled" was ambiguous: 27% or 44% of rows, depending on the reading.**
- _Response: fixed in requirements._ Annex C §C.5 now pins it: no manoeuvre in progress, and
  either none has started yet or the most recent one ended at least 5 min before. Later
  manoeuvres do not count, because a tracker cannot see them. That gives 44% of G5 rows on G0's
  test split; the other reading (27%) is recorded as not meant.
- `scripts/research/spec012-distribution.mjs` implements this definition, and `tma-g5` will reuse
  it.

**S3 (statistics). The realised distribution that Annex C §C.2 requires was not in the G0
outputs.**
- _Response: fixed._ `distribution.json` (from `spec012-distribution.mjs`) records, per split:
  - the counts against the declared weights (test χ² 1.06 on 3 df), and speed changes 30.0%
    (z 0.02);
  - coverage at zig + 5/10/15/20 min (100 / 98 / 83 / 55%);
  - the settled share by gate time;
  - window and zig time by mix;
  - the speed-change side by starting speed;
  - mean turn angle and rate;
  - every split's content digest (reproducibility minor 2).

**R1 (red team). The noisy check is one-sided: an over-stated measurement variance (σ² × 4 to ×
100) passes.**
- This was already true in phase 3, and `trackers.md` said so. The re-scoping did not weaken it.
- _Response: fixed._ The IMM now exposes the normalised innovation squared of each update
  (`ImmState.nis`, the model-probability-weighted ν²/S). Its rows are unchanged.
- New gated check `tracker-nis`: on the same 200 regenerated σ = 1° scenarios, the median
  per-scenario mean NIS from zig + 60 s to the first manoeuvre must lie in [0.75, 1.5].

  | R | Median NIS | Result |
  | --- | --- | --- |
  | Scenario's σ | 1.082 | pass |
  | σ² × 2 | 0.53 | fail |
  | σ² × 0.5 | 2.1 | fail |
  | σ² × 4 | 0.27 | fail |
  | σ² × 100 | 0.014 | fail |

  A unit test asserts the pass at the true σ and the two failures at σ² × 2 and × 0.5.

### Minor findings and responses

- **Spacing check one sample loose** (geometry 3, red team 3). _Fixed:_ `< gap`, matching the
  generator's guarantee, in the check and the sim test.
- **Top-level indices never checked against the spans** (red team 2). _Fixed:_
  `targetManoeuvresFailure` requires `manoeuvre_start_index` to equal the first span's start and
  `manoeuvre_index` the last span's end. Tested.
- **Initial state not checked under 0.5.0** (red team 4). _Fixed:_ sample 0's speed and course
  must equal the drawn parameters. Tested.
- **Known answers miss the partial last step and mid-arc on the 0.5.0 path** (geometry 2).
  _Fixed:_ a 45° turn at 1°/s (45 s) from t = 200 s, with mid-arc and post-arc bearings computed
  by hand.
- **Held-out split not kinematics-checked** (geometry 6). _Fixed:_ the first 2,000 held-out
  scenarios join `independent-geometry` (12,000 scenarios in round 2).
- **No gated post-manoeuvre evidence for speed changes or opposite-sign turns** (numerics 6).
  _Fixed:_ five hand-built cases on the re-convergence geometry are gated at 1e-2 under σ_ct = 0.1
  (`G0_IMM_MANOEUVRE`), worst 5.55e-3:
  - two turns on the same side;
  - two turns on opposite sides;
  - +2 m/s;
  - −2 m/s;
  - turn, speed change, turn.

  G0_IMM itself cannot follow a deceleration (0.93), which the re-tune must handle (Annex C §C.3).
- **The one-turn re-scope is post hoc** (red team 6, statistics). _Recorded:_ here and in spec
  012 FR-002. On substance:
  - The statistics reviewer found it defensible. It restores the population the limit was set on:
    2.32e-3 [1.91e-3, 2.92e-3] at n = 211, and 2.48e-3 on all 2,150 one-turn test scenarios,
    against phase 3's 2.4e-3.
  - The other mixes are reported. The new hand-built cases, now gated, cover them.
- **Summed-Δv tolerance 1e-3 is loose** (numerics 4). _Fixed:_ 1e-5; the worst observed is 4.8e-7.
- **beforeManoeuvre comment said 0.4.0** (numerics 5). _Fixed._
- **The second zig is planned on the straight track, often after the target's first manoeuvre**
  (geometry 1). _Documented_ in `generator.md`: against the actual target it still crosses the
  line of sight in 100% of cases, with the offset outside the drawn 30–90° in 1.0% (phase 3: 1.9%).
- **The speed-change side is predictable from the start speed** (geometry 4, statistics 5).
  _Documented_ in `generator.md`: 82% of changes below 9 kt are increases and 83% above 14 kt
  decreases. Not changed: bounding the size instead would change the size distribution, and the
  prior is declared. It favours a learned tracker over the IMM, so G5's write-up must say so.
- **The count–window correlation shapes the estimand** (statistics 4). _Documented_ in
  `generator.md`. G5 is paired, so it does not favour either estimator. The decision record will
  state it.
- **Redraw lean towards short, fast turns** (statistics 6). _Documented_ (74.3° against 75°,
  1.78°/s against 1.75°/s).
- **Phase-3 consumers silently mis-define 0.5.0 data** (red team 7).
  - _Fixed for `tma-g4`:_ it refuses 0.5.0 data.
  - _Recorded as T007 prerequisites in spec 012:_ `features` `ROWS = 240` must grow to 361
    samples; `velocity_two_hypothesis` must refuse 0.5.0 data; the viewer draws one turn.
  - No phase-4 training happens before those land.
- **g0-guard test hard-codes the phase-3 G0** (reproducibility 1). _Fixed_ in the commit that sets
  `decided_by`, which names this experiment.
- **Old-ranges data now labelled 0.5.0** (reproducibility 3) and **the count stream shares
  splitmix64At(seed, 1) with the main stream's second word** (reproducibility 4). _Noted:_
  provenance only, and changing the count stream would alter 0.5.0 data. No action.
- **"worst Infinity" among the 24 reported hand-built variants** (geometry, statistics). _Answer:_
  this was already in phase 3's verdict. It is a reported, ungated variant (a fast, large turn)
  where G0_IMM's estimate leaves the plausibility bounds. The gated cases are unaffected.

## Round 2

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve | 0 | 0 | 1 |
| Estimation and numerics | approve | 0 | 0 | 3 |
| Evaluation statistics | approve | 0 | 0 | 4 |
| Reproducibility | approve-with-findings | 0 | 0 | 2 |
| Red team | approve-with-findings | 0 | 0 | 4 |

None rejected, and no blocker or major finding is open. Every round-1 major was confirmed resolved:
- **Statistics:** the paired ratio is 1.054 [1.037, 1.075], and 1.028–1.043 on five more seeds.
  The settled definition and `settled()` agree (44.5% on train). `distribution.json` is complete.
- **Red team:** `tracker-nis` fails every σ² scale tried, from × 0.25 to × 100, down to about 1.5 ×.
- **Reproducibility:** round 2 re-ran byte for byte at bddde0f. `distribution.json` re-ran byte for
  byte. `pnpm test` showed one failure, the expected g0-guard test.

### Minor findings and responses (fixed at 93febf5 unless noted)

- **NIS is computed in its own loop, not through `immPredict`** (red team 1, numerics). A defect in
  `immPredict`'s variance or scale handling would not reach it, and it skipped re-initialisation.
  _Fixed:_ `immPredict` takes an `onStep` hook, and the check reads `ImmState.nis` through it, with
  `rScale` passed as a tracker parameter. All 200 scenarios now contribute (181 before); the median
  is 1.061.
- **NIS band misses σ² × 0.75 and is marginal at × 1.5** (statistics 1). _Fixed:_ the band is
  [0.75, 1.3]. × 1.5 gives 0.708 and × 0.75 gives 1.380, so both fail; the gate seed's interval
  upper bound is 1.13. A unit test covers × 2, × 0.5 and × 0.75.
- **The paired statistic loosened the 1.25 limit** (red team 2). A median of ratios sits lower than
  a ratio of medians on the same scenarios (1.05 against 1.27). _Fixed:_ the 0.5.0 limit is 1.15
  (`TRACKER_NOISY_PAIRED_RATIO`), and it passes at 1.054. The docstring now says this check cannot
  see a mis-stated scenario σ, because the initial covariance and the variance then scale together;
  `tracker-nis` covers it.
- **Inf/Inf counted as 1, one-sided failures as 0 or ∞** (numerics). _Fixed:_ the non-converged
  counts are reported (IMM 5, least squares 6 of 1,000).
- **Drawn manoeuvres without spans fall back to the 0.4.0 path** (red team 3). _Fixed:_ a scenario
  that has one without the other fails. Tested.
- **Scenarios contributing no NIS rows unexplained** (red team 4). _Fixed:_ the detail names the
  cause when there are any. There are none now that the check runs through `immPredict`.
- **Second-zig figures not reproducible, and "three" ambiguous** (geometry R2a). _Fixed:_
  `generator.md` gives the series by number of manoeuvres of any kind and cites the panel's run.
- **`tma-g5` must reuse `settled()`; report the settled checks by gate time; state the estimand**
  (statistics 2–4). _Recorded_ as T008 notes in spec 012, for the tool and the decision record.
- **The +2 m/s case has 1.8× margin** (numerics). _Noted:_ not to be loosened without a reason.
- **Uncommitted changes while round 2 ran** (reproducibility 2). Those were these fixes. G0 was
  re-run on them as round 3.

## Round 3

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve | 0 | 0 | 0 |
| Estimation and numerics | approve | 0 | 0 | 0 |
| Evaluation statistics | approve | 0 | 0 | 0 |
| Reproducibility | approve | 0 | 0 | 0 |
| Red team | approve | 0 | 0 | 0 |

All five approve the round-3 run (code 93febf5). What they confirmed:
- **Reproducibility.** `tma-g0` at 93febf5 re-ran byte for byte (verdict, metrics.json,
  metrics.csv) on data regenerated at 5794d6c. `distribution.json` is byte-identical to round 2's.
- **The IMM's rows are unchanged** by the `onStep` hook: `tracker-noise-free` matches rounds 1–2 at
  every printed digit.
- **`tracker-nis` is stable.** Over 11 more seeds the median runs 0.987–1.056, with interval upper
  bounds at most 1.097. It fails σ² × 0.25, 0.5, 0.75, 1.5, 2, 4 and 100.
- **The paired ratio** is 1.054 [1.037, 1.075] against 1.15, and 1.028–1.043 on five more seeds.
- **Every round-2 fix is in place:** a drawn plan without spans fails (261/261 caught).

Recorded limits, no action needed:
- **The variance checks catch errors of about ±25–33% or more.** σ² × 0.8 is caught only
  marginally and × 1.25 not at all, so G0 is no evidence of finer variance calibration (statistics).
- **One contrived case still reaches the 0.4.0 path:** a scenario with both the plan and the spans
  removed but the top-level indices kept (red team nit; 12/261 pass, as before this phase).
- **A step judged implausible still contributes its NIS.** This is harmless, because the median is
  taken over scenarios (numerics).

**Decision: G0 passes on generator 0.5.0** (panel rounds 1–3). `verdict.json` `decided_by` names
this record.
