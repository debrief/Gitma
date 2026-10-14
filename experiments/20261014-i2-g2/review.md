# G2 agent panel review

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open. The brief is summarised in round 1
below. Experiment scored at commit 7bb7641 (data/i2 regenerated at fc6b197; content digests equal
`configs/iter2/{a,b}/plan.json`), committed in 1b8ac4d (PR #41).

**Verdict of record:** `verdict.json` in this folder, as the code wrote it: **G2 FAIL**.

| Check (σ = 1°) | Result | Value [95% CI] | Classical | Naive |
| --- | --- | --- | --- | --- |
| instantaneous range, zig+300 s (< 20%) | pass | 16.50% [16.06, 17.10] | 8.76% | 36.98% |
| instantaneous course, zig+300 s (< 10°) | pass | 9.46° [9.02, 9.90] | 3.42° | 89.9° |
| instantaneous speed, zig+600 s (< 1 kt) | **fail** | 2.09 kt [2.00, 2.18] | 0.62 kt | 4.25 kt |
| time-late range, zig+300 s | pass | 18.48% [17.73, 19.06] | | |
| time-late course, zig+300 s | **fail** | 10.57° [10.16, 11.04] | | |
| time-late speed, zig+600 s | **fail** | 2.38 kt [2.28, 2.48] | | |
| g1-instantaneous (all rows) | pass | model/naive 0.472 [0.458, 0.484] | | |
| g1-time-late (all rows) | **fail** | model/naive 0.514 [0.500, 0.529] | | |
| time-late-not-worse | fail | 14/19 points worse | | |
| controls beaten (both) | pass | | | |
| shuffled labels at naive | pass | 1.015 × naive | | |

n = 4,707 at zig + 300 s (93.2% of the slice) and 2,995 at zig + 600 s (59.3%; decision 13).
Several checks fail decisively, so decision 12's caveat route (consistency-only failure) does not
apply.

## Round 1 (2026-10-14)

Brief: is the harness verdict (fail) right and soundly evidenced; could a pipeline error produce
a spurious fail (speed scaling, units, zig + 600 selection, slice) or a spurious pass on range or
course; is the test split's integrity intact; is anything misreported? ≤ 600 words;
`VERDICT: approve | approve-with-findings | reject`; findings tagged blocker / major / minor.

### Verdicts

| Reviewer | Verdict | Independent evidence |
| --- | --- | --- |
| TMA geometry | approve-with-findings | Frame and truth checked on all 10,000 test scenarios; re-predicted B from rebuilt windows (exact match); per-scenario CRLB on speed: median 0.635 kt, classical 0.621 kt is at the bound, the model is ≈ 3.3 × it |
| Estimation and numerics | approve-with-findings | Re-ran `tma-model-predict` on B weights and scored with own script: exact match; decoding, linear head, gross-row handling checked |
| Evaluation statistics | approve-with-findings | Own Python f32pack reader and bootstrap: every median exact, CIs to the third decimal; binomial CI agrees; speed still 2.30 kt at zig + 300 s |
| Reproducibility | approve-with-findings | Re-ran `tma-g2` from the manifest: verdict, metrics, bootstrap, curves, comparison, held-out and other-phase byte-identical; data digests and weight digests match; SC-005 refusals verified |
| Red team | approve-with-findings | Own scorer: exact match; no leakage (inputs, normalisation, split indices); range pass not carried by short ranges (< 5 km band 0.244, among the worst) |

All five agree the recorded verdict (G2 fail) is right. Speed is not a units or scaling artefact:
signed median error +0.16 kt, mean prediction 11.58 kt vs truth 11.69 kt, slope of prediction on
truth ≈ 0.57 (shrinkage to the mean; errors largest for 0–5 kt and 15–20 kt targets). The
information is in the bearings: classical sits at the Cramér–Rao bound.

### Findings and responses

**M1 [major; reproducibility, red team, statistics; minor per geometry, numerics] Phase A's test
predictions overwrote phase B's on disk.** `scoreSplit` wrote `predictions/<split>.<id>.ndjson`
for both sets; phase A shares B's model ids and ran second. The verdict is unaffected (scored in
memory; every reviewer reproduced B independently), but re-scoring from `data/i2/predictions`
silently gives phase A.
*Response — fixed in ddcb027:* the other phase now writes `predictions/<split>.other-phase.<id>.ndjson`;
`g2.test.ts` asserts the carried set's files survive and the other phase's are tagged. `data/` is
not committed; the on-disk files of this run remain phase A's, and the reviewers' scratch re-predictions
of B match the verdict exactly.

**M2 [major, interpretation; numerics] The models were stopped by validation noise, not converged.**
Train loss still falling (LSTM 0.400 → 0.377 over epochs 60–73; BiLSTM 0.486 → 0.448); validation
loss moves ±3% per epoch, more than the per-epoch gain, so patience 6 stopped them.
*Response — accepted; stated in the record:* G2 fails **for this architecture, input set and
training budget** (150 epochs max, patience 6). It does not show that a network cannot reach 1 kt.
The write-up (blog, results page) will say so, and iteration 2b's options include the budget
(longer, or a smoothed stopping criterion) beside derived features. The verdict itself is not
changed by this: it is the pre-registered rule applied to the carried set.

**m1 [minor; statistics] gate-g2 failed a check whose CI straddled the threshold when the point
was at or above it; FR-015 and R8 say inconclusive.**
*Response — fixed in ddcb027:* fail now requires the CI lower bound ≥ threshold (or an invalid
sample); the test case for a straddling CI with the point above the threshold expects
`inconclusive`. Re-gating this experiment's committed metrics with the new code gives identical
checks (every failing check here has its lower bound ≥ threshold).

**m2 [minor; statistics] spec FR-014 and US4 scenario 1 still said speed at zig + 300 s.**
*Response — fixed in ddcb027* (zig + 600 s, decisions 8 and 13, coverage stated).

**m3 [minor; statistics, red team] g1-time-late fails on the boundary.** CI lower bound 0.50035;
with five other bootstrap seeds the lower bound is 0.4995–0.5006, so it is seed-sensitive.
*Response — recorded:* reported as "fail, on the boundary (seed-sensitive)". The gate outcome
does not depend on it: speed fails with its CI wholly above 1 kt (lower bounds 2.00 and 2.28 kt).

**m4 [minor; red team] The PR body said "fail, on speed" only.** Time-late course and g1-time-late
also fail.
*Response — fixed:* PR #41 body and this record list every failing check; speed is the decisive
one (both variants, CI wholly above 1 kt; lower bounds 2.00 and 2.28 kt).

**m5 [minor; reproducibility, numerics, red team] An earlier test attempt.** `test.classical.ndjson`
(06:29Z) predates 7bb7641: the first `--split test` run computed naive and classical, then stopped
at the normalisation guard before any model was scored.
*Response — recorded:* that attempt exposed baseline numbers only; no model was scored on test
before the run of record, so the test split served one model decision. The fix in 7bb7641 changes
only the guard (provenance-only header differences, constants identical, both headers clean).

**m6 [minor; numerics, red team, reproducibility] The provenance tolerance checks headers, not
content; the manifest records whole-file digests, not the plan's content digests.**
*Response — answered for this run, carried forward:* `train-plan.mjs check-digests` passes for
`data/i2` against both `configs/iter2/a` and `b` (three reviewers ran it), and the normalisation
constants are identical. Making `tma-g2` check the plan's content digests itself, and recording
them in the manifest, is a follow-up task for iteration 2b (not needed to decide this gate).

**m7 [minor; reproducibility] decision.json `decided_at` (19:40Z) is after its commit (19:29:35Z).**
*Response — recorded:* clerical (the time was written by hand, rounded); the commit time is the
binding one and precedes phase-B training (checkpoints from 21:44Z).

**m8 [minor; reproducibility] The SC-005 guard checks the decision is committed now, not that it
predates the phase-B weights.** *Response — recorded:* ordering verified by hand (decision
5ca1f59 → merge b13474a → phase-B weights record `git_commit` b13474a → carried set fc6b197 →
test). A tool check (decision commit is an ancestor of the weights' `git_commit`) is a follow-up.

**m9 [minor; red team] The same-rows check compares counts, not row identity.** *Response:* rows
confirmed identical in this run by the red team; follow-up, as m8.

**m10 [minor; red team] The shuffled-label control's course (70.3° vs naive 90.3°) is mildly
truth-informed** (best-epoch selection on true-label validation loss; naive's 90° is a weak
course reference). *Response:* course is reported, not gated; noted here.

**m11 [minor; numerics] Speed is ≈ 15% of the loss with equal weights.** *Response:* a lever for
iteration 2b, recorded in research.

**m12 [minor; geometry] `speed_scale_mps` (max ownship speed) also scales target speed (up to
1.33).** Inputs-only, linear head, harmless. *Response:* noted; a sentence goes into the feature
layout page with the write-up.

**m13 [info; reproducibility] The phase-B shuffled-label weights equal phase A's** (its validation
loss never improved on A's). *Response:* expected; noted.

**m14 [minor; reproducibility] The manifest's provenance notes do not say which lineage is carried
and which other-phase.** *Response:* b13474a is phase B (carried), a7a3f33 phase A (other-phase);
recorded here.

## Round 2 (2026-10-14)

Brief: are your findings fixed or answered, and do the fixes introduce new problems? (≤ 300 words.)

| Reviewer | Verdict | Remaining |
| --- | --- | --- |
| TMA geometry | approve-with-findings | [minor] stale phase-A files on disk under the carried names |
| Estimation and numerics | approve-with-findings | [minor] the tooling follow-ups (R19) must land before iteration 2b scores a gate |
| Evaluation statistics | approve | [minor] the new rule could pass with the point ≥ threshold if the CI's upper bound were below it; [minor] stale files on disk |
| Reproducibility | approve | [minor] stale files on disk; [minor] state that the changed gate code was re-gated |
| Red team | approve-with-findings | [minor] "CI wholly above 2 kt" is false for lstm-instantaneous (lower bound 1.9997 kt) |

The reviewers checked the round-1 fixes, M1 and m1, against the code and tests: 14 of 14 tests
pass. The reproducibility and red-team reviewers each re-gated the committed metrics with the
new gate code and got identical checks, detail text included.

Responses (commit 1fb0f5a and this record):
- **Pass also requires the point below the threshold.** A check now passes only if the CI's
  upper bound and the point are both below the threshold; otherwise it is inconclusive. A test
  covers this. Nothing in this run changes.
- **CI wording corrected.** Speed now reads "CI wholly above 1 kt; lower bounds 2.00 and 2.28 kt",
  here and in the PR body.
- **Stale files on disk.** The phase-A files under the carried names in `data/i2/predictions`
  have been renamed `test.other-phase.<id>.ndjson`, which is what the fixed code writes. They are
  phase A's predictions. Re-run `tma-g2` to regenerate phase B's on disk. `data/` is not committed.
- **Gate code changed after scoring.** The manifest names 7bb7641. The gate code changed in
  ddcb027 and 1fb0f5a, and re-gating the committed metrics with that code gives identical checks.
  This was done three times: my run and the reproducibility and red-team reviewers' runs.
- **Tooling follow-ups (R19).** These are the content-digest check in `tma-g2`, decision ancestry
  for SC-005, and row identity. They are prerequisites for iteration 2b's gate.

No reviewer rejects, and no blocker or major finding is open. **G2 decision: FAIL** (SRD §5).
Decision 5 therefore allows iteration 2b, whose leads are listed in research R6, R18 and R19.

Not done: T045's turn-only diagnostic (G1 models on `configs/iter2-turn-only-test-ranges.json`),
which is reported only, not gated. No tooling exists for it. It is deferred to iteration 2b and
recorded in tasks.md.
