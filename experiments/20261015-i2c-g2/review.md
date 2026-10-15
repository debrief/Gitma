# G2 agent panel review, iteration 2b

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open. Experiment scored at commit 3bce9ff (data/i2
regenerated at 3bce9ff; content digests equal `configs/iter2/c/plan.json`, including the fresh
test split of seed 202, checked by `tma-g2 --plan` and recorded in `manifest.json`), committed in
55eb94b (PR #46). Carried set: the 2b models (`experiments/20261015-i2c-val/models`), declared in
`experiments/20261014-i2c-decision/` before training; phase B beside as `other-phase/`.

**Verdict of record:** `verdict.json` in this folder, as the code wrote it: **G2 FAIL**.

| Check (σ = 1°) | Result | Value [95% CI] | Phase B (beside) | Classical | Naive |
| --- | --- | --- | --- | --- | --- |
| instantaneous range, zig+300 s (< 20%) | pass | 14.61% [14.13, 15.20] | 16.46% | 8.45% | 37.87% |
| instantaneous course, zig+300 s (< 10°) | pass | 8.22° [7.88, 8.54] | 9.20° | 3.31° | 90.4° |
| instantaneous speed, zig+600 s (< 1 kt) | **fail** | 1.77 kt [1.68, 1.83] | 2.02 kt | 0.60 kt | 4.22 kt |
| time-late range, zig+300 s | pass | 15.79% [15.21, 16.22] | 19.18% | | |
| time-late course, zig+300 s | pass | 8.66° [8.29, 9.03] | 10.36° | | |
| time-late speed, zig+600 s | **fail** | 1.77 kt [1.67, 1.86] | 2.31 kt | | |
| g1-instantaneous (all rows) | pass | model/naive 0.418 [0.405, 0.432] | | | |
| g1-time-late (all rows) | pass | model/naive 0.430 [0.419, 0.443] | | | |
| time-late-not-worse | fail | 2/19 points worse (t = 840, 960 s) | | | |
| controls beaten (both) | pass | | | | |
| shuffled labels at naive | pass | 1.000 × naive | | | |

n = 4,682 at zig + 300 s (93.4% of the slice) and 2,973 at zig + 600 s (59.3%; decision 13).
Speed fails decisively for both variants (CI lower bounds 1.68 and 1.67 kt), so decision 12's
caveat route (consistency-only failure) does not apply.

**Two invocations of `tma-g2`.** The first (06:13–06:57 UTC) scored the test split fully and
exited 2 at the held-out step: `data/i2/predictions/heldout.classical.ndjson`, cached from the
iteration-2 run, carried the whole-file digest of the earlier `heldout.f32pack` (regenerated at
3bce9ff with a new provenance header; content digest identical, 57d766df…). That file was deleted
and the same command re-run unchanged (06:57–07:57 UTC); the committed folder is the second run's.
Every test-split output of the second run (`verdict.json`, `metrics.json`, `bootstrap.json`,
`curves.csv`, `comparison.*`, `models/`, `other-phase/`) is byte-identical to the first's. The
held-out cache guard behaved as designed (it refused a file whose truth digest did not match);
follow-up: validate cached predictions by the truth file's content digest rather than its
whole-file digest, so a provenance-only regeneration does not invalidate them (R19-style tooling
note in spec 004).

## Round 1 (2026-10-15)

Brief (`scratchpad/panel2b/brief.md`): is the harness verdict (fail, on speed, both variants)
right and soundly evidenced; could the speed fail be an artefact (units, scaling, the zig + 600
selection, the re-scoring of the best epoch under the new loss, the continuation seeding); could
the range/course passes be inflated (leakage, a fresh split that is not fresh, the carried-set
rule, the other-phase scoring); are the new integrity checks (plan digests, decision ancestry,
same rows, fresh_test) doing what the record says; is anything misreported? ≤ 600 words;
`VERDICT: approve | approve-with-findings | reject`; findings tagged blocker / major / minor.

### Verdicts

| Reviewer | Verdict | Independent evidence |
| --- | --- | --- |
| TMA geometry | approve-with-findings | Reproduced the gate numbers from truth and predictions (1.7669 / 1.7729 / 0.6025 kt, byte-equal); speed metric, frame and units checked (`errors.ts:48`, `KNOT_MPS`, linear head); included vs excluded scenarios at zig + 600 s differ only in window length; classical's speed error scales with range as observability predicts, the models' is flat (1.5–2.4 kt in every range and bearing-rate band, 1.78–1.83 kt from zig + 720 to 1080 s) |
| Estimation and numerics | approve-with-findings | Config diff B → 2b exactly `max_epochs`, `loss_weight_speed`; re-scored losses reproduced to 5 decimals (0.51648, 0.64108, 1.84506) and the 2b best epochs' losses exactly; prediction-on-truth slope 0.576 → 0.650, residual std 2.38 → 2.21 kt (scatter dominates: inverting the fit would give 2.32 kt); per-scenario CRLB on this split: classical |err|/σ median 0.618 (efficient 0.6745); no float32, unit or clipping artefact |
| Evaluation statistics | approve-with-findings | Every check recomputed from its own interval and threshold; own resampler [1.6848, 1.8310] vs harness [1.6839, 1.8334], binomial order-statistic [1.6847, 1.8364]; fail margin 20.2 SE (instantaneous) and 16.4 SE (time-late); only 31.8% / 29.8% of scenarios have speed error < 1 kt; Bonferroni-equivalent 99.6% intervals change nothing; phase B on seed 202 vs 201 inside each other's intervals |
| Reproducibility | approve-with-findings | Re-gate, re-evaluate (naive refitted, classical and five model files) and re-predict lstm-instantaneous: all byte-identical; plan digests, fresh-test digest, decision ancestry (f328b23 → 45d7e7a), weights digests and 0/10 000 scenario overlap with seed 201 verified; the committed folder is one command's output (07:09–07:57 UTC) |
| Red team | approve-with-findings | Per-scenario seed = SplitMix64(seed + (i+1)·γ): a 201/202 collision needs an index difference of 1.0 × 10¹⁸; 0 seed and 0 parameter-hash overlap; inputs carry nothing from truth (`layout.ts`, `predict.ts:211`, `normalise.ts`); only `--allow-dirty` bypasses a check and `git_dirty` is false; model predictions are never cached; re-prediction of 40 scenarios matches the carried files to 0 m and phase B's weights reproduce the other-phase files |

Every reviewer reproduced the speed medians independently; none found a path from a pipeline
error to the verdict. One latent major (not triggered in this run) and 19 minor findings.

### Findings and responses

**M1 [major, latent; numerics] The re-scored best loss is not persisted.** On a resume with an
optimizer restart `train.ts` re-scored the best weights under the new loss and used that value in
memory, but a chained job (optimizer restored) reset `best` from the manifest's old-loss
`val_loss`. If a continuation's first job had ended before any epoch beat the re-scored value,
later jobs would have compared new-loss epochs against the lower old-loss number, never improved,
and kept the phase-B weights silently. *Not triggered here* (reviewer's evidence from the CI
logs): lstm-instantaneous finished in job 1; bilstm-time-late's job 2 resumed after epoch 92 with
best epoch 92 and job 3 after epoch 124 with best 119, so `best` was a new-loss value at every
resume. The committed 2b weights are what the record says.
*Response — fixed in this PR:* schema 0.8.2 adds `best_val_loss` to the model manifest (the value
a later epoch must beat, under this manifest's config); `train.ts` writes it on every manifest
write, rewrites the manifest immediately after a re-score (so a job that dies before its first
epoch still hands the value on), and resumes from it. `scripts/train-continue.mjs` drops the
source's value (the new config's loss differs) and records the source as `continued_from`
(weights digest, best epoch, old-loss value, commit). A test seeds a continuation with a loss
change, kills job 1 after one epoch, and checks job 2 resumes against the re-scored value with
no second re-score. Schema goldens regenerated (`schema_version` only).

**m1 [minor; geometry] `speed_scale_mps` is 15 kt (ownship's maximum), so target speeds of
15–20 kt map to scaled targets above 1; shrinkage is worst exactly there.** *Response — recorded:*
input-only normalisation (constitution, no leakage); the output scale is a modelling choice, and
iteration 2c (decided before this gate was scored) keeps it. Noted in the write-up as a lead that
was not tried.

**m2 [minor; geometry] "The models beat classical on range beyond 10 km" holds only at
zig + 300 s and is driven by classical's non-convergence tail (10–20 km, σ = 1°: model 12.5%,
classical 13.1% all rows but 11.7% converged-only; 117 of 1,806 non-converged scored ∞). At
zig + 600 s classical is better in every band.** *Response — fixed in the write-up:* the results
page and blog post say this.

**m3 [minor; geometry, statistics] `time-late-not-worse` has no interval. The two exceedances
(1.0546, 1.0557 against 1.05) have paired bootstrap ratio intervals [1.003, 1.105] and
[0.981, 1.118], both containing 1.05, so its fail is not distinguishable from a pass; what is real
is a small, consistent late-time deficit (time-late / instantaneous > 1 at 17 of 19 points from
180 s, median ratio ≈ 1.03; rows near the end of their windows, where a BiLSTM has little backward
context).** *Response — recorded, check unchanged:* the check does not decide G2 (both speed
checks fail decisively) and changing its rule after scoring would be post hoc. The record and the
write-up report it as the G1 caveat persisting (time-late is not shown better, and not shown
worse by more than the slack). Giving the check a paired interval like the G1 ratio checks is a
tooling follow-up (below).

**m4 [minor; statistics] Phase B's split-to-split differences (seed 201 vs 202) are of the order
of one interval half-width; time-late course was a fail on 201 and would be inconclusive on 202.**
*Response — recorded:* speed is 16–20 SE from its threshold, so it does not matter here; any 2c
check within ~2 SE of its threshold should be read with this in mind.

**m5 [minor; reproducibility, numerics, red team] The committed 2b manifests do not record the
continuation: no source weights digest, the phase-B epochs keep their old-loss `val_loss` beside
the new-loss epochs, and the re-scored values are only in the CI log.** *Response — fixed for
future runs (M1: `continued_from`, `best_val_loss`); the facts for this run are recorded here:*
lstm-instantaneous: best epoch 67 (0.34628 under weight 1) re-scored 0.51648 under weight 4, 2b
best epoch 104 at 0.46172; bilstm-time-late: 60 (0.42754) re-scored 0.64108, 2b best 134 at
0.51461; mlp-control 0.85311 → best 0.83782; cnn-causal-control 1.02258 → 1.01006; each stopped
patience 6 after its best. The committed manifests are the training run's own output and are not
rewritten after the fact.

**m6 [minor; reproducibility, red team] The 2b shuffled control's weights are phase B's,
byte-for-byte (`f0a8be9a…`), though its config says `loss_weight_speed` 4.** *Response —
recorded:* correct behaviour. Its best epoch (1) re-scored at 1.84506 under the new loss and none
of epochs 2–10 beat it (minimum 1.84759), so the old weights were kept; the shuffled check
(1.000 × naive) therefore repeats phase B's on the fresh split. The other-phase shuffled
predictions are identical to the carried ones for the same reason.

**m7 [minor; reproducibility] `data/i2/predictions/validation.classical.ndjson` is a stale cache
(digest of the earlier `validation.f32pack`) that will refuse, not corrupt, the next validation
run.** *Response — done:* deleted locally; not used by this gate. Follow-up: validate cached
predictions by the truth file's content digest (see the two-invocation note above).

**m8 [minor; reproducibility] `site/docs/results/iteration-2b.mdx` links `review.md` on `main`,
which does not exist yet.** *Response:* this PR adds the file; the link resolves on merge.

**m9 [minor; reproducibility] Byte-identity of inference was shown on one CPU; the per-CPU-family
caveat applies to prediction too.** *Response — recorded:* `cpu_model` is in the manifest; iteration 1's re-score on another
runner differed by 1.3 × 10⁻⁵ relative (blog 2026-10-12) and the capacity scan (research R20,
PR #45) by ≤ 1 × 10⁻⁵, far inside the 0.67 kt margin.

**m10 [minor; red team] Seeds 201 and 202 have each decided a G2 but only 42 and 101 are
reserved in `scripts/train-plan.mjs`.** *Response — fixed:* 202 is reserved as a dataset seed;
as a fresh-test seed 201 and 202 are reserved except in the committed plan that decided with
them (`configs/iter2/c/plan.json` for 202, bound to the path after round 2), so the plan of
record still validates. Tested. Advisory only: a plan is visible in its PR and names its seed.

**m11 [minor; red team] Prediction headers carry no weights digest, so a foreign model file is
indistinguishable by header; safe today only because model predictions are never cached.**
*Response — recorded:* follow-up (below).

**m12 [minor; red team] `gitDecisionPrecedes` trusts the manifest's self-reported `git_commit`,
and the plan file is not checked for being committed.** *Response — recorded:* the red team and
the reproducibility reviewer verified `git_commit` (45d7e7a) against CI run 38555531269's head
independently; `git_dirty` is false for the run. Follow-up (below).

**m13 [minor; red team] CI run 38555531269 shows conclusion "failure".** *Response — recorded:*
the time-late model's first two chained jobs ended at the 345-minute limit by design (the
hand-off to the next job); the third job and the evaluate step succeeded, and the results branch
`results/i2c-38555531269` matches the committed `experiments/20261015-i2c-val` blob for blob.

**m14 [minor; numerics] "Classical at the Cramér–Rao bound" was carried over from the seed-201
analysis.** *Response — recorded, now recomputed:* on this split the per-scenario bound gives a
median σ_speed of 1.05 kt and classical's |error| / σ has median 0.618 (an efficient Gaussian
estimator: 0.6745), 70.7% within 1σ. The write-up cites this recomputation.

**m15 [minor; numerics] `decision.json` says the speed term was ~15% of the loss; measured
16.4% (lstm) and 16.6% (bilstm).** *Response — recorded:* cosmetic; the decision record is not
edited after the fact.

**m16 [note; red team] The red team's own classical speed median (0.577 kt) differs from the
verdict's 0.6025 kt.** *Response:* its script skipped classical's non-converged rows (1.35%),
which the evaluator scores as infinite error and includes (`errors.ts:29-40`); the model medians,
which have no such rows, agree to four decimals.

### Tooling follow-ups (not needed to decide this gate)

- Cached predictions validated by the truth file's content digest, not its whole-file digest
  (the held-out cache incident; m7).
- A paired bootstrap interval for `time-late-not-worse`, reported as pass / fail / inconclusive
  like the G1 ratio checks (m3).
- Prediction headers record the predicting model's `weights_digest` (m11).
- `tma-g2` checks the plan file is committed and, where a CI results branch exists, that the
  manifest's `git_commit` matches the run's head (m12).

## Round 2 (2026-10-15)

Brief (`scratchpad/panel2b/round2.md`): are your findings fixed or answered; does the fix
(17b8399) introduce a new problem (an uninterrupted run and a resume without a loss change
unchanged; seed reservation correct for the committed plans; goldens `schema_version` only); is
the record accurate? ≤ 300 words.

| Reviewer | Verdict | Remaining |
| --- | --- | --- |
| TMA geometry | approve-with-findings | m1–m3 answered accurately; blog figures recomputed and right; three wording minors (below) |
| Estimation and numerics | approve-with-findings | M1 fix verified line by line: chained path resumes from `best_val_loss`; uninterrupted and loss-unchanged resumes identical; manifest rewrite safe (temp + rename, `complete` false, checkpoint untouched); committed 2b manifests parse under 0.8.2; two minors (below) |
| Evaluation statistics | approve | m3, m4 recorded accurately; every verdict-table entry recomputed from the files; leaving `time-late-not-worse` unchanged is sound (consistency-only in `g2Verdict`; an interval version would give inconclusive, never pass); one minor (below) |
| Reproducibility | approve-with-findings | Goldens one byte each (`schema_version`); `schema:check` passes; 17b8399 touches nothing under `experiments/`, `configs/`, `data/`; `cli-gate g2` on the committed metrics under the fixed build gives `verdict.json` byte-identical (exit 3); m5–m8 match the manifests; two minors (below) |
| Red team | approve-with-findings | Reservation refuses 202 elsewhere and dataset seed 202; `best_val_loss` cannot be steered in a seeded manifest (overwritten by the re-score) but is trusted in a chained job; two minors (below) |

No reviewer rejects; no blocker or major finding is open. Round-2 minors and what was done
(commits 2eb1b11 and 4fd40bd, pushed after the round; full checks pass):

- **[minor; numerics] The chained-job test did not exercise the failure mode** (job 1's first
  new-loss epoch already beat the re-scored value, so the old lookup happened to return a
  new-loss number; the old code failed the test only on the absent field). *Fixed:* the test now
  sets the best epoch's recorded `val_loss` to 0 after job 1 and checks job 2 still resumes
  against `best_val_loss` (the old code would read 0 and never improve again).
- **[minor; numerics] `continued_from` was carried from a prior manifest even when the run did
  not resume it** (config differed; fresh model built). *Fixed:* carried only in the resume branch.
- **[minor; red team] The re-scored value was recorded only in the CI log, so a `best_val_loss`
  edited low on a checkpoint branch would keep the source weights silently; `continued_from` was
  never checked against the weights.** *Fixed:* `tma-train` writes `continued_from.rescored_val_loss`
  at the re-score, and `tma-train --check` (run by every CI job) verifies a completed continuation:
  a best epoch after the source's has `best_val_loss` equal to that epoch's `val_loss`; the source's
  epoch kept means `best_val_loss` equals the re-scored value and `weights_digest` equals the
  source's. Tested on a tampered manifest.
- **[minor; red team, reproducibility, geometry] The fresh-test exemption was keyed on the plan's
  self-declared id, and `RESERVED_SEEDS` applied only under `configs/iterN/`.** *Fixed:* reserved
  seeds are refused whatever the path; the exemption is bound to `configs/iter2/c/plan.json`.
- **[minor; statistics] Seed 201 was not reserved as a dataset seed, so a plan outside iteration 2
  could regenerate the split that decided iteration-2 G2.** *Fixed:* dataset seed 201 is accepted
  only under `configs/iter2/`.
- **[minor; geometry] Page wording:** the range-band claim needs the σ = 1° qualifier (at all
  noise the model stays ahead at 10–20 km even converged-only, 13.6% vs 15.4%); the time-late
  caveat should say "slightly worse at 17 of 19 points, not better"; the output-scaling lead
  belongs on the page, not only in the blog. *Fixed* on the results page and in the blog post.
  The reviewer also corrected its own round-1 wording: the late-time deficit of 3.5–5.6% holds
  for 780–960 s, not from 720 s.
- **[minor; reproducibility] m9's response cited research R20, which was on PR #45, not yet on
  this branch's ancestry.** *Fixed* in the response text above (iteration 1's 1.3 × 10⁻⁵
  re-score is the in-branch evidence; #45 has since merged).

**Decision.** Round 2 approved with minors only (constitution 1.2.0: no rejection, no open blocker
or major). `verdict.json` `decided_by` is set to this round. The post-round fixes are tooling and
wording; nothing under `experiments/20261015-i2c-g2/` other than this file and `decided_by`
changed after scoring, and the reproducibility reviewer re-gated the committed metrics under the
fixed build byte for byte.
