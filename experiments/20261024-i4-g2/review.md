# G2 agent panel review, iteration 4

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open. Carried set: the iteration-4 models
(`experiments/20261023-i4a-val/models`, trained at d124f3c on `train/i4a`, runs 39827501938 and
39948611113), declared in `experiments/20261022-i4-decision/` (committed in d124f3c, before
training); the iteration-3 models beside as `other-phase/`. Scored at f6298ac's parent on branch
`iter4/gate`, data regenerated locally by `scripts/train-plan.mjs data configs/iter4/a/plan.json`
(content digests equal the plan's; checked by `tma-g2 --plan` and recorded in `manifest.json`).

**Verdict of record:** `verdict.json` in this folder, as the code wrote it: **G2 INCONCLUSIVE**.

| Check (σ = 1°) | Result | Value [95% CI] | Iteration 3 (beside) | Classical | Naive |
| --- | --- | --- | --- | --- | --- |
| instantaneous range, zig+300 s (< 20%) | pass | 7.12% [6.8, 7.4] | 8.8% | 3.38% | 39.1% |
| instantaneous course, zig+300 s (< 10°) | pass | 4.85° [4.65, 5.06] | 6.4° | 1.37° | 91.7° |
| instantaneous speed, zig+600 s (< 1 kt) | **inconclusive** | 0.981 kt [0.940, 1.031] | 1.14 kt | 0.314 kt | 4.23 kt |
| time-late range, zig+300 s | pass | 5.20% [5.0, 5.4] | 7.2% | | |
| time-late course, zig+300 s | pass | 2.99° [2.86, 3.14] | 4.23° | | |
| time-late speed, zig+600 s | pass | 0.754 kt [0.722, 0.789] | 1.03 kt | | |
| g1 ratios, controls, shuffled labels, time-late-not-worse | pass | | | | |

n = 4,977 at zig + 300 s and 3,250 at zig + 600 s. Held-out (20–30 km, reported only):
LSTM speed 2.79 kt, BiLSTM 2.34 kt, classical 1.51 kt.

**Two invocations.** The first invocation scored the test split and wrote `verdict.json`,
`paired.json`, the metrics, bootstrap, comparison, curves and `other-phase/`, then stopped at the
held-out split, whose features had not been built (no manifest written). The data step was rerun
for test and held-out and the gate re-invoked. Every test-split file of the first run (kept in the
session scratchpad, `gate-run1/`) is byte-identical to the committed one; only `heldout/`,
`manifest.json` and `seeds.txt` are new. All five reviewers judged that the split was scored once
in substance: fixed weights, content-pinned data and deterministic scoring leave no choice between
runs.

**Order of events.** The decision record and rule were committed in d124f3c (2026-10-22), before
training. The CI validation result (results branch, 2026-10-23) met FR-006 before any test
scoring. The first gate invocation started at about 05:34:04 UTC on 2026-10-24, 51 s before the
commit adding `../20261023-i4a-val/validation.md` (cc6e04a, 05:34:55); no test output existed
before the classical solver finished, about 8 minutes later.

## Round 1 (2026-10-24)

Brief: is the harness verdict (inconclusive on instantaneous speed; everything else passes) right
and soundly evidenced; could any pass or the near-pass be an artefact (leakage through the derived
features or the velocity scale, the decode, the zig + 600 s selection, the other-phase scoring,
freshness, lineage); does the two-invocation event compromise the record; does SRD §7's re-score
route apply and what should be pre-registered; is anything misreported? ≤ 600 words;
`VERDICT: approve | approve-with-findings | reject`; findings tagged blocker / major / minor.

### Verdicts

| Reviewer | Verdict | Independent evidence |
| --- | --- | --- |
| TMA geometry | approve-with-findings | Decode (atan2(vx, vy) clockwise from north, ‖v‖ × 10.29 m/s), bearing rate (causal least squares over rows t−17..t) and intercept (x cos b − y sin b) checked against source and by derivation; gate medians recomputed from regenerated truth and predictions (0.981 / 0.754 / 0.314 kt; 4.85°); speed error by true speed, range, bearing rate and phase: models track classical where geometry is weak and keep a 0.6–0.8 kt floor where it is strong, never beating classical in any bin, the opposite of a leak's signature |
| Estimation and numerics | approve-with-findings | Encoding, loss weights [1, 4, 4, 0] and decode inverse checked; parameter counts by hand (204,804; 540,676); best epochs, patience and chained timing consistent; weights digests and results-branch blobs equal; 400 test scenarios re-predicted byte-identically for both carried models; `bootstrapMedian` on independently computed errors reproduces 0.9808 [0.9405, 1.0312]; classical at the Cramér–Rao bound (median ratio 0.672 vs 0.674 efficient); LSTM 1.62 × the bound |
| Evaluation statistics | approve-with-findings | Every check recomputed with an independent resampler and an exact order-statistic interval (LSTM speed [0.943, 1.034]); 50.6% of rows under 1 kt (sign test p ≈ 0.24); paired ratios reproduce; validation → test shift 0.043 kt, z = 1.5 (noise plus selection); simulated power for the re-score |
| Reproducibility | approve-with-findings | Seed 205 regenerated from scratch: all four content digests ok; code at gate equals code at training outside the workflows; decision ancestry and CI head shas checked; weights identical across results branch, validation and gate folders; `tma-eval` + `tma-gate g2` on the committed predictions reproduce every output byte for byte; `paired.json` recomputed deep-equal; two-invocation claim confirmed with `diff -rq` |
| Red team | approve-with-findings | No truth in any input or normalisation; velocity scale a generator constant; 0 seed collisions between seed-205 test and seeds 1, 7, 42, 101–103, 201–205 (indices 0–120k); decision unchanged since d124f3c; configs equal `configs/iter4/a`; a single results branch, and the first run's evaluate step never scored; iteration-3 models scored on their own normalisation, same rows |

All five reproduced the inconclusive verdict independently; none found a path from a pipeline
error to it. Three major findings, all about what follows the verdict rather than the verdict
itself.

### Findings and responses

**Major**

1. *(geometry)* **The LSTM's speed is biased low**: median signed error −0.41 kt at zig + 600 s,
   −1.50 kt for 18–20 kt targets; slope of predicted on true speed 0.88 (classical 0.985). This is
   the velocity loss's magnitude shrinkage under course uncertainty (spec 008 research R2), and a
   large share of the 0.98 kt. *Response: accepted.* Recorded here and in the write-up; no
   recalibration is admissible for this gate, and the re-score uses the same frozen weights.
   (Numerics adds that removing the bias entirely would give 0.84–0.90 kt: the rest is scatter.)
2. *(statistics)* **The SRD §7 re-score applies but must be pre-registered, and current tooling
   refuses it.** *Response: accepted.* The owner chose the re-score on 2026-10-24: fresh seed 206,
   100,000 test scenarios, the same five frozen models (weights digests named), the full G2
   verdict on the new split alone deciding, not pooled with seed 205, inconclusive counting as
   fail. The decision record and tooling are submitted to round 2 before any seed-206 data exist.
3. *(red team)* **The re-score cannot run with current tooling** (`fresh_test` is generated at the
   plan's count; the ancestry guard requires the decision to predate the weights' commit; seed 205
   is reserved). The change must replace the guard, not drop it. *Response: accepted.* Round 2
   reviews: a `fresh_test.count` that generates only the fresh test split; a re-score binding that
   requires a committed decision naming the inconclusive experiment and the exact weights digests,
   in place of the training-ancestry rule; seed 206 reserved for it; and streaming evaluation so
   100,000 scenarios fit in memory, proved byte-identical on the seed-205 gate.

**Minor**

4. *(numerics, statistics, red team)* The validation figure (0.94 kt) is optimistic: it chose the
   best epoch (a one-epoch dip) and the carry. *Response:* stated in `validation.md` and the
   write-up; the power analysis uses the test estimate.
5. *(statistics)* `validation.md` labels validation figures "pass". *Response:* relabelled "under
   threshold on validation".
6. *(numerics, reproducibility, red team)* Record the two-invocation event and its byte-identity.
   *Response:* recorded above. The manifest lists the second command only; this file is the record
   of both.
7. *(reproducibility)* The gate started 51 s before the "carry" note was committed. *Response:*
   stated under "Order of events"; the binding rule and the validation result came first.
8. *(red team)* `runG2` writes `verdict.json` before scoring held-out and writing the manifest.
   *Response:* the re-score tooling checks that every split's features exist before scoring.
9. *(geometry)* At zig + 300 s, 65% of rows are in ownship's second turn; speed is judged on leg 3.
   *Response:* stated in the write-up, as spec 007 already describes.
10. *(geometry)* Speed predictions are bounded (0.2% / 0.8% above 20 kt; classical 4.8%); none
    non-converged. *Response:* noted.
11. *(red team)* The shuffled control's speed error (11.3 kt) is the velocity encoding's mean-zero
    output, not a fault; the control says nothing about speed. *Response:* stated in the write-up.
12. *(red team)* Neither spec 008 nor the decision record names the inconclusive route.
    *Response:* SRD §7 has carried it since 2026-10-11 (730c035); the re-score decision cites it.
13. *(reproducibility)* `g2.ts` logs the plan's feature path for other-phase models before falling
    back to their own. *Response:* fixed with the re-score tooling.
14. *(statistics)* The write-up should say the instantaneous median is statistically
    indistinguishable from 1 kt (51% under), and that a re-score passes with probability about
    0.78 if the true median is 0.98 kt. *Response:* accepted.

## Round 2 (2026-10-24)

Brief: are the round-1 responses adequate; is the re-score tooling (branch `iter4/rescore-tooling`,
3a014eb + 655b8d6) correct, with no guard weakened and streaming provably equivalent; is the
pre-registration (`../20261024-i4-rescore-decision/`, `configs/iter4/r/plan.json`) complete and
unambiguous before any seed-206 data exist? ≤ 500 words.

Tooling evidence submitted: a replay of this gate through the streaming path (normal mode, default
heap, predictions recomputed after moving `data/i4/predictions` aside, then restored) gave every
output byte-identical except manifest/seeds paths, commit, id, time and `schema_version`; peak RSS
921 MB.

### Verdicts

| Reviewer | Verdict | Main points |
| --- | --- | --- |
| TMA geometry | approve-with-findings | Round 1 answered; problem, gate points and ranges unchanged; seed-206 split from the same distribution; **major**: only `weights.bin` bound, the manifest's `velocity_scale_mps` (and `model.json`, decode code) could change the speed bias unchecked |
| Estimation and numerics | approve-with-findings | Own equivalence check on the real seed-205 split: evaluation, bootstrap and every LSTM record identical; writer round-trip byte-identical; model digests verified; **major**: bind `manifest.json` and `model.json` |
| Evaluation statistics | approve-with-findings | Pre-registration matches round-1 recommendations; streaming statistically identical (same error order and PRNG draws); forecast table confirmed; **major**: the plan can change after the decision (count, ranges) |
| Reproducibility | approve-with-findings | Replay confirmed; streaming `tma-eval` + `tma-gate` on the committed predictions byte-identical (421 MB); `generate-splits.mjs` byte-identical to `tma-generate` at two counts; `packages/{sim,data}/src` unchanged since the G0 commit; no 100k seed-206 split anywhere |
| Red team | approve-with-findings | No overlap of seed 206 with any used seed; **majors**: bind every model file; bind the re-scored gate (committed, panel-decided, same weights digests); one re-score per gate escapable (scratch folder, aborted run, second decision); plan changeable after the decision |

### Findings and responses

All majors were fixed in eefe748 (schema 0.11.1) before any seed-206 data exist.

1. *(geometry, numerics, red team; major)* **Bind every model file.** *Fixed:* `model_digests`
   lists the SHA-256 of each model's `weights.bin`, `manifest.json` and `model.json`, and
   `tma-g2` checks all three. The weights must also equal the model's own manifest digest and the
   digest recorded in this gate's manifest. The decode code is unchanged since this gate
   (`git diff f6298ac -- packages/features/src packages/eval/src/errors.ts` is empty); the
   re-score's review checks it again at the scoring commit.
2. *(red team; major)* **Bind the re-scored gate.** *Fixed:* its `verdict.json` and
   `manifest.json` must be committed and unmodified, and `decided_by` must name a panel round. The
   carried weights must equal those its manifest records.
3. *(statistics, red team; major)* **Bind the plan.** *Fixed:* the decision carries
   `fresh_test_count` (1,000,000), which must equal the plan's. The plan may differ from its
   content at the decision's commit only in `fresh_test.digest`. A dirty test-data header is
   refused.
4. *(red team; major)* **One re-score per gate.** *Fixed:*
   - The experiment folder must sit beside this gate.
   - `rescore.json` is written, create-exclusive, before any scoring. A folder or sibling holding
     one, or a manifest note, for this gate is refused, as is any other committed decision naming
     it.
   - `--allow-dirty` is refused in re-score mode.
5. *(statistics, red team; minor)* **The decisive rule is `verdict.json`'s result**, including the
   time-late consistency check; controls are reported only. *Fixed* in `decision.md`.
6. *(statistics; minor)* **The interval is asymmetric** (−0.013 / +0.016 kt), so a pass needs a
   point below about 0.984 kt. Also recorded: outright fail ≈ 0 at true medians ≤ 0.98 kt;
   P(fail | 1.00 kt) = 0.98; two looks raise the false-pass rate from 1.8% to 3.7%. *Fixed* in
   `decision.md`.
7. *(geometry; minor)* **Record the expected bias** (median signed error about −0.4 kt, slope
   about 0.88) as a check on a changed model. *Fixed* in `decision.md`.
8. *(red team, numerics; minor)* **`--skip-heldout` weakens a normal gate.** *Fixed:* allowed only
   in re-score mode.
9. *(red team, reproducibility; minor)* **State how the re-score is run.** *Fixed* in
   `decision.md`: locally, once, from a clean tree after the digest pin, log kept, every
   invocation recorded.
10. *(reproducibility; minor)* **Tests generated seed-206 data.** *Fixed:* they use seeds
    207/208.
11. *(numerics, reproducibility; minor)* **Record the replay's data swap and the prediction-file
    comparison.** *Answered:* the replay moved `data/i4/predictions` aside and restored it after.
    The tooling report recorded all 17 regenerated prediction files as identical except the
    header's `schema_version`, and numerics' writer round-trip confirms it.
12. *(numerics; minor)* **`FileLookup` opens the file on every read.** *Answered:* this costs
    performance only, and an open descriptor would leak because lookups are never closed. Not
    changed.
13. *(geometry; minor)* **Keep n, excluded counts and phases visible in the write-up.**
    *Accepted.*

## Round 3 (2026-10-24)

Brief: are the round-2 findings fixed (eefe748, schema 0.11.1) and recorded (648acc5), and must
anything change before (a) this verdict's `decided_by` names round 3 and (b) seed-206 data are
generated, the digest pinned and the re-score run once? ≤ 400 words.

### Verdicts

| Reviewer | Verdict | Main points |
| --- | --- | --- |
| TMA geometry | approve-with-findings | All 15 model-file digests recomputed and matching; problem code and ranges unchanged since this gate; 26/26 g2 tests pass; minors only |
| Estimation and numerics | approve-with-findings | All round-2 findings fixed; the scoring and decode code is unchanged since the gate apart from streaming (proved equivalent in round 2); 51/51 tests; minors only |
| Evaluation statistics | approve-with-findings | Plan binding (content at the decision's adding commit, `fresh_test_count`, dirty data) correct; decisive rule and forecast wording fixed; 49/49 tests; minors only |
| Reproducibility | approve-with-findings | Digests recomputed in both model folders; clean `git archive` build identical; 44 tests pass in the clean copy; no 100k seed-206 split exists; minors only |
| Red team | approve-with-findings | All four round-2 majors confirmed fixed, each with a test; minors only |

No rejections and no open blocker or major finding: **the panel approves the verdict of record,
G2 INCONCLUSIVE, and the re-score pre-registration.** `decided_by` in `verdict.json` names this
round.

### Findings and responses (all minor)

1. *(numerics, geometry, reproducibility)* **The decision was amended in round 2 without saying
   so.** *Fixed:* `decision.md` states the amendment (eefe748, before any seed-206 data).
2. *(red team, reproducibility)* **The decision itself is not frozen.** *Fixed in tooling* (see
   the re-score's record): `tma-g2` refuses a decision changed after the plan's last change (the
   digest pin), and requires every carried model file to be tracked and unmodified in git.
3. *(geometry)* **Bind the problem itself.** *Fixed in tooling:* the seed-206 test header's
   `parameter_ranges` and `generator_version` must equal this gate's test header.
4. *(numerics)* **Code drift between round 3 and scoring.** *Fixed in `decision.md`:* the
   re-score's review records `git diff 648acc5 <scoring commit> -- packages scripts configs`,
   which must show only the round-3 tooling fixes and the digest pin.
5. *(statistics)* **No rule for an aborted run.** *Fixed in `decision.md`:* one repeat into the
   same folder, after panel approval, with the marker removed under a recorded note.
6. *(reproducibility)* **Test seeds 207/208 are the next in the fresh series.** *Fixed in
   tooling:* the tests use 9207/9208.
7. *(red team)* **The second-decision scan reads only sibling `decision.json` files.**
   *Answered:* a second re-score is already blocked by the folder rule and the marker. Not
   widened.
8. *(red team)* **"Once" rests partly on process** (an untracked marker can be deleted, and
   seed-206 data could be scored off the record with other CLIs). *Answered:* every input is bound
   by content, so a peek gains no lever. The marker and the full run log are committed with the
   result.
9. *(red team)* **Pin the digest from a clean tree and have it reproduced independently.**
   *Accepted:* the pin commit changes only the plan's digest, and the re-score's panel reproduces
   the content digest by regenerating seed 206's test split.
10. *(geometry, numerics)* **The re-score write-up must report the bias** against the forecast
    (median signed speed error about −0.4 kt, slope about 0.88), with n, excluded counts and the
    phase split at both gate points. *Accepted.*

## Round 4 (2026-10-24, short)

Brief: since round 3, check 3a9cce1 (round-3 minors in tooling), 129799b (the digest pin) and
526ef33 (`tma-g2` removes each other-phase model's own-normalisation features cache after its
predictions are written: five such files are 8 GB at 100,000 scenarios against about 22 GB free).
Each reviewer independently regenerated seed 206's test split.

| Reviewer | Verdict | Main points |
| --- | --- | --- |
| TMA geometry | approve | Digest reproduced, generated at 526ef33, so it does not depend on the generating commit; ranges identical to seed 205's test split |
| Estimation and numerics | approve | Digest reproduced; no scoring or decode code changed; 526ef33 cannot change a scored output |
| Evaluation statistics | approve | Digest reproduced (925,610,440 bytes); the guards touch no statistic; minor: record that the deleted caches can be rebuilt |
| Reproducibility | approve-with-findings | Digest reproduced; headers differ only in the commit field; minors: the manifest note's text changes ("removed after scoring"); the freeze check compares last-change commits, so the commit range is reviewed by hand |
| Red team | approve-with-findings | Digest reproduced; 129799b is one line; 526ef33 deletes only the other phase's cache; minor: confirm that no commit after 129799b touches the plan or the decision |

**All five approve; no blocker or major finding.** The re-score may run once as pre-registered.

Minor findings, answered:

1. *(statistics)* **The deleted other-phase caches are reproducible.** Each is rebuilt
   deterministically from seed 206's test split and that model's committed normalisation, by the
   same `tma-g2` path.
2. *(reproducibility)* **"Outputs unchanged" overstates it.** One manifest note's wording changes;
   no scored output does.
3. *(reproducibility, red team)* **Review the commit range by hand.** After 129799b, only 526ef33
   (`packages/models` only) and this record (`experiments/20261024-i4-g2/review.md`) are
   committed. Neither touches `configs/iter4/r/plan.json` or the decision. The re-score's
   `review.md` repeats this check at the scoring commit.
