# G0 agent panel review: iteration 3 (generator 0.3.0)

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open.

**Why G0 was re-run.** Iteration 3 (spec 007) changes the generator to 0.3.0. It adds the
across-the-line-of-sight rule (`zig_rule: across_los`) and an optional second zig
(`zig2_delay_s`). The G0 guard therefore refuses the 0.2.0 G0.

**Data.** Seed 42, 100,000 noise-free scenarios from `configs/iter3-ranges.json`, generated at
90f4873. Every scenario has two rate-limited turns, both across the line of sight.

**Evidence.**

- Round 1: `../20261017-g0-i3/` at c804757.
- Round 2: `../20261017-g0-i3-r2/` at 5989b3e. It carries the round-1 fixes to the G0 checks and
  the zig bands up to 180°.
- Round 3: this folder, at 928995a. It carries the round-2 fixes: the step lower bound and the
  turn sums. Metrics and seeds are byte-identical to round 2.

The generator source (`packages/sim/src`, `packages/data/src`) is unchanged from 90f4873, so the
same data stand throughout.

| Check | Round 1 (c804757) | Rounds 2–3 (5989b3e, 928995a) |
| --- | --- | --- |
| classical-recovers-noise-free-truth | pass; worst range 8.70e-6, course 2.54e-3°, speed 3.43e-4 kt | same |
| classical-per-timestep-recovers | pass; 67,208/67,208 rows ≥ 60 s after the zig | same |
| bearing-residuals-at-float32-precision | pass; worst 2.77e-7 rad | same |
| independent-geometry | pass; hand cases incl. leg 3; 20,000 turns across the line of sight | pass; adds the second turn in both directions (mid-arc and leg 3), ownship kinematics on every scenario (round 3: also arc chord ≤ step and summed turn = stored angle), \|turn\| ≤ 180°, unchecked turns counted |
| naive-baseline-reproduces | pass | pass |

## Round 1 (2026-10-17)

| Reviewer | Verdict |
| --- | --- |
| TMA geometry (independent RK4 integration of all 10,000 test and held-out tracks: worst 6.6e-4 m, 1.4e-5°; 0 index mismatches in 50,000; every one of 20,000 turns across the line of sight, inside 30–90°, the shorter way) | approve-with-findings |
| Estimation and numerics (verdict figures reproduced; 716,632 per-timestep rows over the whole split, rows in and after the second turn ≤ 1.24e-5 range; headroom 3–115× better than iteration 2; `simulateTruth` from stored float32 parameters reproduces every stored value bit for bit on all four splits) | approve-with-findings |
| Evaluation statistics (re-ran G0 at eb19125; redraw, window, coverage and band statistics; regenerated data identical) | approve-with-findings |
| Reproducibility (re-ran G0 from the manifest at c804757: data, metrics, seeds and verdict byte-identical; 0.3.0 reproduces every pinned iteration-2 digest, seeds 201 and 203; seed-204 digests reproduce; guard behaviour exercised case by case) | approve-with-findings |
| Red team (ten mutations of the second turn and the rule; decision-record bypass; leakage) | approve-with-findings |

### Major findings and responses

| # | Finding (reviewer) | Response | Commit |
| --- | --- | --- | --- |
| M1 | Two second-turn mutations pass G0: the second arc flown the wrong way (`omega` sign) and leg 3 left on the leg-2 track while its course is written. Both corrupt the model's course input. G0's checks use positions only, and the across-LOS check reads only the post-turn course (red team) | `independent-geometry` now checks ownship kinematics on every scenario: each step ≤ v·dt, the chord's heading between the stored courses at its ends, and the course change ≤ ω·dt per step. It also adds hand-computed second-turn cases in both directions, mid-arc and on leg 3, and \|turn\| ≤ 180°. Both mutations fail it (unit tests in `packages/eval/test/g0-checks.test.ts`). The real data pass: 0 of 10,000 on the G0 test and held-out splits, seed-204 validation and iteration-2 test. The reviewer's stricter mean-course chord test fails at every step where a turn ends mid-step, so the bracketing form is used | 5989b3e |
| M2 | The seed-204 test split could be scored now with the 2c decision record: `ChangeDecision` names no plan, and a decision is required only because `configs/iter2/b` exists (red team) | `ChangeDecision` gains `plan` and `test_seed` (schema 0.9.0). From iteration 3, `tma-g2 --split test` refuses without a committed decision that names the plan being scored, and checks its test seed against the plan. The 2c decision is refused for `configs/iter3/a` (tests in `packages/models/test/g2.test.ts`) | 5989b3e |
| M3 | FR-006's validation rule compared with 2c's iteration-2 validation figures. The easier problem alone clears 1.36 kt (R2 forecasts 1.1–1.3 kt), and the "or" gives two chances (statistics) | FR-006 rewritten. Both sets are scored on the same seed-204 validation rows: the 2c models as the other phase, which `tma-g2 --compare-models` now writes paired into `paired.json`. The carried pair goes to test only if two conditions hold. First, the iteration-3 LSTM / 2c LSTM median speed ratio at zig + 600 s, σ = 1°, has a paired 95% interval wholly below 1. Second, the LSTM's G2 speed interval has a lower bound under 1 kt. The time-late model is reported, not a condition. The model / classical ratio is reported beside, against 2c's 2.37 | 5989b3e, 04c1844 |
| M4 | "zig + 300 s" changes meaning. On the test split 59% of scenarios are mid-way through the second turn there and 37% on leg 3; at zig + 600 s, 99.9% are on leg 3, with a median of 280 s of it (statistics; geometry as a minor) | Spec 007 "Reading the gate under three legs" and the decision record state it. The G2 report will say that range and course are judged mostly during the second manoeuvre and speed after 4–5 min of leg 3, with re-baselined classical beside every figure. The SRD §3 row says so | 5989b3e |
| M5 | `pnpm test` failed at eb19125: the G0 guard test still expected no accepted G0 once the 0.3.0 G0 was committed (reproducibility) | Fixed in 7d860de. The test asserts that the committed 0.3.0 G0 is the latest and is accepted only with `decided_by` from a panel round and `review.md` beside it; it now names round 2. The full suite passes (320 tests) | 7d860de, 04c1844 |

### Minor findings and responses

| Finding (reviewers) | Response |
| --- | --- |
| The committed metrics predate the zig-band change; a re-run at HEAD splits "90+deg" into three bands (statistics, red team, reproducibility, numerics) | Round 2 re-ran G0 at 5989b3e: this folder has the 90–120°, 120–150° and 150–180° bands |
| G0's across-LOS check would not catch a turn the long way round; unchecked turns were skipped silently (geometry, red team M2b) | \|zig\|, \|zig2\| ≤ 180° is now checked, and skipped turns fail the check (5989b3e) |
| Planning a turn from the observed bearing cannot be seen on noise-free G0 data (red team M4) | The generated-scenario unit test (`packages/sim/test/unit/second-zig.test.ts`) now runs at σ = 2°, so a rule planned from the observed bearing breaks its 30–90° offset bounds |
| Research R4 said targets on the quarter are crossed by turning away; 3,398 of 9,191 turn towards, through the bow line of sight (geometry) | R4 and the generator note corrected: the turn is towards when \|ρ\| + φ < 180°, otherwise away |
| The rule holds at the turn's start; on the new leg 5.9% of turns are outside 30–90° and 26 of 20,000 have the target back on the original bow, all under about 3 km (geometry) | R4, the generator note and the glossary say "judged from the bearing at the start of the turn" and give the figures |
| Turns near 180° are near-ambiguous in direction: 207 of 20,000 are over 179° (geometry) | Documented in R4 and the generator note as a property of the rule; a cap would change the problem (spec 007 Risks) |
| Redraws select longer windows and faster turns: window p10 16.7 min, 10–15 min windows 5.6% against 16.7% if uniform (statistics) | Spec 007 gives the realised distribution and coverage at both gate points; SRD §3 row updated |
| Some first-turn bands are tiny (30–50°: 84 test scenarios); bands are not comparable across iterations (statistics) | FR-008: every slice is reported with its n, under 100 rows is indicative, and bands are not compared across iterations |
| The second turn is not a slice key (statistics) | Not added; the second-turn size is in the metadata for a diagnostic if needed |
| Delay quantisation: the end values 180 s and 300 s carry half weight (statistics) | Documented in spec 007 |
| Per-timestep speed headroom is thin on the full split: leg-2 rows reach 7.09e-3 kt, and one ungated early row 1.36e-2 kt; the check reports worst range only (numerics) | Two-leg conditioning, as in iteration 2, not a 0.3.0 effect. The numerics reviewer's full-split figures are recorded here; extending the check's detail is left for the next G0 change, as it would change no verdict |
| The drawn offsets are not stored, so G0 checks the offset range to 1e-4 rather than the value to 1e-7 (numerics) | Left as is. The realised turns are stored, so the tracks reproduce exactly; recording the offsets would need another schema change |
| The manifest's `tma-generate` line has no `--out`, and the data and G0 commits differ (reproducibility) | The data are identified by their sha256 in the manifest, and `generator_git_commit` (90f4873) is in the dataset header. The lineage is: data at 90f4873, G0 round 1 at c804757, round 2 at 5989b3e, with no generator change between them |
| G0 does not score the held-out split (red team) | As in iterations 1–2. The geometry reviewer integrated the held-out split independently: worst 6.7e-4 m, 0 index mismatches |
| Leakage: the post-turn course bounds the true bearing to a 60° band. It cuts the RMS bearing error at the turn sample by 1.5% (1 bearing, σ = 1°) to 0.5% (10 bearings); turn timing and redraws reveal no range, course or speed (red team) | Negligible; recorded |

## Round 2 (2026-10-17)

The reviewers re-checked their round-1 findings at c648455 against the round-2 evidence (G0 at
5989b3e).

| Reviewer | Verdict |
| --- | --- |
| TMA geometry: own RK4 tracks pass the new checks; mutations: long-way turn with matching \|zig\| and leg-3 course +5° fail, long-way turn with the short angle stored and leg 3 at 0.98 v pass | approve-with-findings |
| Estimation and numerics: new checks' margins on all four splits (110,000 scenarios): step 50×, course rate 21×, chord bracket 11× | approve |
| Evaluation statistics: FR-006 condition against 2c is a weak reference, since 2c degrades on the new problem | approve-with-findings |
| Reproducibility: round 2 re-run from its manifest byte-identical; full suite 320/320; guard accepts round 2 only once panel-decided | approve-with-findings |
| Red team: round-1 survivors M1b, M5b and M2b now fail G0, and M4 fails the σ = 2° unit test; new M7 (second turn at half rate) fails; new M8 (leg 3 at 0.9 v) is caught only by the hand case; decision-binding bypass attempts stopped | approve-with-findings |

### Major finding and response

| # | Finding (reviewer) | Response | Commit |
| --- | --- | --- | --- |
| M6 | FR-006 condition 1 (iteration-3 LSTM beats 2c on the same rows) compares with a reference that degrades on the new problem. On scratch seed 9001, 2c's LSTM is at 1.93 kt here against 1.49 kt on the iteration-2 ranges, so a model worse than 2c on its own problem would pass (statistics) | Spec 007 FR-006 and the decision record now say that a change to the problem has no like-for-like counterfactual. The **operative** condition is a possible G2 speed pass: the iteration-3 LSTM's validation interval has a lower bound under 1 kt. Beating 2c on the same rows stays as a **sanity** condition, labelled a weak reference and never cited as evidence that the lever worked. The measure of what the models gained is the paired ratio of model to classical speed error on the same rows, with its interval, against 2c's 2.37. `paired.json` now carries it | 928995a |

### Minor findings and responses

| Finding (reviewers) | Response |
| --- | --- |
| No lower bound on step length: a slower ownship (0.98 v, 0.9 v, frozen) passes the per-scenario check (geometry, red team, numerics) | Each step must be at least the full-step arc chord, 2(v/ω) sin(ω dt/2), which is v·dt on a leg (3df0750). No false failures on the four splits; tests added |
| A turn flown the other way round to the same course, with the short angle stored, passes (geometry) | Each rate-limited turn's summed course change must equal its stored signed angle, to within 1e-4 rad (3df0750); test added |
| Decision binding keyed on the plan's path: a copy elsewhere, or another spelling, escaped it; a bound decision without `test_seed` passed (red team, reproducibility, statistics) | A decision binds by the plan's path or its content (a test seed of 204 or later). Paths are compared resolved, and a bound decision must name its `test_seed` (3df0750); tests added. The train-plan seed ownership was already a second layer |
| The planned gate command needs `stalled: true` because `--compare-models` implies a phase B (red team) | The decision record sets `stalled: true` and says why: the previous configuration (2c) failed G2 |
| `tma-model-predict` plus `tma-eval` can score seed 204's test split outside the gate (red team) | Known limit since iteration 2: only the gate CLIs check the decision. The gate of record is `tma-g2` with the committed decision; any other scoring is not a gate result |
| The schema changed under the same version (reproducibility) | Bumped to 0.9.1; the goldens change only in `schema_version` (928995a) |
| The round-1 folder's verdict still read "pending" (reproducibility) | Marked superseded (928995a); round 2 likewise, once round 3 ran |
| `pnpm test` timed out once under load (train.test.ts, time-late resume) (reproducibility) | Load-dependent; it passes alone and on a re-run (320/320, then 323/323 at 928995a) |

**G0 round 3.** G0 was re-run at 928995a (this folder) so the verdict's checks are the code of
record. The kinematic and turn-sum checks pass on all 10,000 test scenarios; the data and every
other figure are unchanged.

## Round 3 (2026-10-17): final confirmation

The reviewers checked their round-2 findings at b1e36fc against this folder (G0 at 928995a).

| Reviewer | Verdict |
| --- | --- |
| TMA geometry: both long-way mutations (short angle stored) now fail on the turn sum; leg 3 at 0.98 v fails on the step floor; own RK4 tracks and the real data pass | approve |
| Estimation and numerics: no false failures on 110,000 scenarios; leg-3 mutations at 0.8 v, frozen, and +0.01° course now caught 193/200, 193/200 and 200/200, where the 7 misses have a one-sample leg 3 that the mutation does not change | approve |
| Evaluation statistics: relabelled FR-006 answers M6; `pairedComparison` emits both references on the same rows | approve |
| Reproducibility: round 3 re-run from its manifest byte-identical; full suite 323/323 at b1e36fc; binding and guard cases re-exercised | approve-with-findings |
| Red team: M8 now fails G0; every path spelling and plan copy refused with the 2c decision; the correct decision accepted for every spelling and a symlink | approve-with-findings |

### Minor findings and responses

| Finding (reviewers) | Response |
| --- | --- |
| A forged plan copy, with its dataset seed edited and the digests kept, still bound nothing, so the 2c decision unlocked seed 204's test data (red team) | A decision now also binds by the `dataset_seed` in the test data's own header, and a bound decision's `test_seed` must match it (0df0df2); test added. It is outside G0's scope, so no re-run was needed |
| 2c's 2.37 is an unpaired ratio from another problem (statistics) | Spec 007 and the decision record call it context only, not a threshold the paired interval is tested against |
| The round-1 verdict linked to `../20261017-g0-i3-r2/review.md`, which moved (reproducibility) | The link now points to this folder |

**Decision.** No reviewer rejects, and no blocker or major finding is open. G0 passes on generator
0.3.0, and `decided_by` names panel round 3. Training on the iteration-3 data may start once the
iteration-3 decision record is committed (spec 007 FR-005).

