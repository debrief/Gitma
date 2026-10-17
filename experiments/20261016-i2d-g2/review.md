# G2 agent panel review, iteration 2c

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open. Experiment scored at commit 4b5a45e (data/i2
regenerated at 0688d9e, the results commit the branch starts from, by `scripts/train-plan.mjs data
configs/iter2/d/plan.json`, so the dataset headers name 0688d9e; content digests equal the plan's, including the fresh test split of seed 203, checked by `tma-g2 --plan` and recorded in
`manifest.json`), committed in 1b29b0d (PR #48). Carried set: the 2c models
(`experiments/20261016-i2d-val/models`, trained at 49d786e on `train/i2d`), declared in
`experiments/20261015-i2d-decision/` before training; the 2b models beside as `other-phase/`.
Iteration 2c is the last allowed under G2 (SRD §7, amended 2026-10-15).

**Verdict of record:** `verdict.json` in this folder, as the code wrote it: **G2 FAIL**.

| Check (σ = 1°) | Result | Value [95% CI] | 2b (beside) | Classical | Naive |
| --- | --- | --- | --- | --- | --- |
| instantaneous range, zig+300 s (< 20%) | pass | 13.48% [12.95, 13.85] | 15.3% | 8.76% | 37.18% |
| instantaneous course, zig+300 s (< 10°) | pass | 7.36° [7.05, 7.70] | 8.27° | 3.41° | 90.5° |
| instantaneous speed, zig+600 s (< 1 kt) | **fail** | 1.47 kt [1.37, 1.52] | 1.78 kt | 0.61 kt | 4.44 kt |
| time-late range, zig+300 s | pass | 12.10% [11.69, 12.60] | 15.8% | | |
| time-late course, zig+300 s | pass | 6.12° [5.87, 6.41] | 9.12° | | |
| time-late speed, zig+600 s | **fail** | 1.53 kt [1.47, 1.61] | 1.77 kt | | |
| g1-instantaneous (all rows) | pass | model/naive 0.387 [0.375, 0.397] | | | |
| g1-time-late (all rows) | pass | model/naive 0.347 [0.336, 0.357] | | | |
| time-late-not-worse | fail | 3/19 points worse (t = 1020–1140 s) | | | |
| controls beaten (both) | pass | | | | |
| shuffled labels at naive | pass | 1.027 × naive | | | |

n = 4,689 at zig + 300 s (93.3% of the slice) and 3,038 at zig + 600 s (60.4%; decision 13).
Speed fails decisively for both variants (CI lower bounds 1.37 and 1.47 kt), so decision 12's
caveat route does not apply. One invocation of `tma-g2`; the prediction caches were cleared before
it because every split's provenance header changed with the regenerating commit (the 2b cache
incident, `../20261015-i2c-g2/review.md`).

## Round 1 (2026-10-16)

Brief (`scratchpad/panel2c/brief.md`): is the harness verdict (fail, on speed, both variants)
right and soundly evidenced; could the speed fail be an artefact (units, scaling, the zig + 600
selection, the stacked architecture's output head, from-scratch training with speed weight 4);
could the range/course passes be inflated (leakage, a fresh split that is not fresh, the
carried-set rule, the other-phase scoring); are the integrity checks doing what the record says;
is anything misreported; is the record sufficient for a no-go decision and what should the
write-up say? ≤ 600 words; `VERDICT: approve | approve-with-findings | reject`; findings tagged
blocker / major / minor.

### Verdicts

| Reviewer | Verdict | Independent evidence |
| --- | --- | --- |
| TMA geometry | approve-with-findings | Reproduced the gate medians and the zig + 600 s selection from truth and predictions (byte-equal); included vs excluded scenarios differ only in window length; speed error by range band and bearing-rate band still flat (1.2–2.0 kt) where classical falls to 0.1–0.4 kt; the 2c gain is a uniform −0.2 to −0.3 kt shift concentrated in slow targets (3–9 kt), with slope 0.65 → 0.71 and residual 2.23 → 2.11 kt; held-out 20–30 km speed is 0.8 × the naive prior |
| Estimation and numerics | approve-with-findings | Architecture and parameter counts recomputed by hand (203,268 and 537,604); every manifest epoch matches the CI log line by line across the five chained BiLSTM jobs; re-prediction of 200 scenarios identical to the carried file; per-scenario Cramér–Rao bound on this split: classical |error|/σ median 0.659 (efficient 0.6745), models 1.30, 9 × the bound below 3 km; with all speed-dependent bias removed the median error would still be 1.35 kt (the floor is scatter) |
| Evaluation statistics | approve-with-findings | Every check recomputed under FR-015; harness-seed bootstrap replay reproduces the intervals exactly, own resampler and binomial order-statistic intervals agree; fail margins 12.2 and 14.4 SE; 36.5% / 33.4% of scenarios under 1 kt; the interval would touch 1 kt only below n ≈ 78; paired 2c − 2b on the same rows −0.31 kt [−0.41, −0.23] and −0.24 kt [−0.32, −0.15]; split-to-split differences ≤ 1.4 SE across all twelve checks; Bonferroni-equivalent intervals change nothing |
| Reproducibility | approve-with-findings | Re-gate, re-evaluate (naive refitted, classical and five model files, held-out too) and re-predict bilstm-time-late on another CPU family: all byte-identical; plan digests, fresh-test digest, decision ancestry (445f26c → 49d786e → 4b5a45e → HEAD), weights digests, results-branch identity (blob for blob apart from validation.md) and the five-job BiLSTM record verified; 0 overlaps between the seed-203 test scenarios and all 220,000 seed-201 and seed-202 scenarios |
| Red team | approve-with-findings | Decision record unchanged since 445f26c, four hours before training; plan unchanged; 2c weights reproduce the carried files and 2b weights the other-phase files to 0.0; every `tma-g2` check ran with no bypass (only `--allow-dirty`, recorded false); the shuffled control's 77.5° course is bearing-tracking geometry, not label information (range 1.027 × naive, speed 4.42 vs naive 4.44 kt) |

Every reviewer reproduced the speed medians independently; none found a path from a pipeline
error to the verdict; all five judge the record sufficient for a no-go decision. No blocker or
major finding; 19 minor findings, below.

### Findings and responses

**m1 [minor; geometry, numerics] Speed error still does not scale with observability.** By true
range at zig + 600 s (σ = 1°) the LSTM is 1.98 / 1.21 / 1.19 / 1.42 / 1.98 kt (0–2 / 2–5 / 5–10 /
10–20 / 20–40 km) against classical 0.12 / 0.13 / 0.28 / 0.75 / 1.61; by bearing rate 1.3–1.8 kt
flat against 0.4–0.9. The model/classical ratio is largest (3.7 ×) where the geometry is best.
*Response — recorded, carried into the write-up:* this is the central finding of the no-go.

**m2 [minor; geometry] The 2c gain over 2b is a uniform shift, not a geometric one:** −0.21 to
−0.30 kt in every range band and at every time, coming entirely from slow targets (3–6 kt
1.74 → 1.14 kt; 6–9 kt 1.70 → 1.19) with 9–15 kt and 18–20 kt unchanged; the BiLSTM's extra
early gain converges to the LSTM by 600 s. *Response — recorded, in the write-up.*

**m3 [minor; geometry, numerics] Shrinkage eased, scatter dominates:** slope of prediction on
truth 0.654 → 0.711 (LSTM), 0.642 → 0.733 (BiLSTM; classical 0.98); residual SD 2.23 → 2.11 and
2.31 → 2.12 kt; a slope forced to 1 with the same residual would give 1.39 / 1.29 kt, and
removing all speed-dependent bias leaves 1.35 kt. Fast targets are still pulled down (18–20 kt
predicted 16.2–16.7 kt), where scaled targets exceed 1 (`speed_scale_mps` = 15 kt, 2b m1).
*Response — recorded:* the output scaling stays an untried lead, stated as such in the write-up.

**m4 [minor; geometry, statistics] `time-late-not-worse` fails at 3 of 19 points with no
interval; paired ratio intervals at 1020 / 1080 / 1140 s ([1.005, 1.188], [0.963, 1.188],
[0.961, 1.188]) all contain 1.05.** The shape is new: time-late is better than instantaneous at
13 of 19 points to 780 s (ratios 0.58–0.97) and worse at every point from 840 s (1.01–1.10), the
deficit largest at σ = 2° and worst near the window end; on speed the BiLSTM is worse than the
LSTM at every point from 420 s despite seeing the whole window. *Response — recorded; check
unchanged (consistency-only; it cannot decide G2):* validation.md's explanation was partial and
has been corrected (3a1da65); the write-up states the shape. The paired-interval follow-up from
2b stands.

**m5 [minor; geometry] Held-out geometry (initial range 20–30 km, σ = 1°, zig + 600 s):** range
29.1% / 30.1% vs classical 18.7% (10% non-converged scored ∞), course 21° vs 14°, speed
3.39 / 3.33 kt vs classical 3.62 and naive 4.24 kt: the models' speed there is 0.8 × the naive
prior; they beat classical only at zig + 300 s, where classical is 23% non-converged, and have
no gross tail (11% vs 22%). *Response — recorded, in the write-up:* outside the training range
band the models carry no usable speed information.

**m6 [minor; statistics] The trend 2.09 → 1.77 → 1.47 kt is real (split noise ≤ 0.05 kt) but a
pass needs a median ≲ 0.93 kt, a further −37%, more than both steps combined; the capacity
scan already showed saturation (192 units 2.25 kt vs 2 × 128 units 2.24 kt) and the loss weight
bought −15% with speed at ~16% of the loss; one training seed per model leaves seed-to-seed
variance unmeasured.** To believe a further step the panel would need a pre-registered
validation diagnostic with the whole interval below ~0.9 kt from at least two training seeds and
a scan showing the lever not yet flat. *Response — accepted as the panel's no-go statement;* its
text is in the write-up with the caveats (three different test splits, one seed per model, two
levers).

**m7 [minor; statistics] Report the fraction of scenarios under 1 kt (36.5% / 33.4%) and the
sample size at which the interval would touch the threshold (n ≈ 78 / 56); they say more than the
SE margin.** *Response — done in the write-up.*

**m8 [minor; numerics, reproducibility] `cpu_model` names only the last job's CPU:** the LSTM
trained across EPYC 9V45 → 7763 → 9V74 and the BiLSTM across 9V74 → 7763 → 7763 →
Xeon 8573C → 9V45 (per-epoch times 1,300 / 2,030 / 1,930 / 1,340 / 840 s mark the regimes); no
chained run is byte-reproducible by re-training; checkpoint branches are single squashed commits,
so the per-job history is only in the manifests' `seconds` and the CI metadata. *Response —
recorded here:* the job boundaries are LSTM after epochs 50 and 73 (three jobs, run
38720086506); BiLSTM after epochs 14, 24 and 34 (run 38720086506, each at the 345-min limit) and
49 (run 38849609775 job 1), finishing in its job 2 (10:01–15:36 UTC); both runs show conclusion
"failure" because the limit hand-offs are reported as failures. The weights of record are the
committed ones; a verdict is reproduced by re-scoring them (AGENTS.md), never by re-training.

**m9 [minor; numerics] The last-fetched checkpoint branch for time-late (15:08:56 UTC) holds 72
epochs, `complete: false`, while the job ended 15:36:57 with 74; its `best/weights.bin` equals the
committed weights.** *Response — recorded:* the workflow deletes the checkpoint branches once the
results branch is pushed; the stale state was a local fetch from before the final sync. No effect
on the record.

**m10 [minor; reproducibility] `train_features_digest` / `val_features_digest` are whole-file
digests of CI's features at 49d786e; locally rebuilt features cannot match them, so training-input
lineage is verified by header-minus-provenance and normalisation equality, not by digest.**
*Response — recorded:* the content digests of the f32pack files (plan-checked) pin the scenarios;
a content digest for features files is a tooling follow-up (below).

**m11 [minor; red team, geometry] The brief and PR said the data were regenerated at 4b5a45e;
the dataset headers name 0688d9e.** *Response — corrected in this record's header:* the branch
was created at 0688d9e (the CI results commit) and the data regenerated there before the
validation note was committed as 4b5a45e, where `tma-g2` ran; both are clean commits and the
content digests are the pin.

**m12 [minor; red team] `decision.md` says "one seed per model (1001)"; the configs use 1001–1005
(the BiLSTM 1002).** *Response — recorded:* one training seed per model, as decision 11 requires;
the decision record is not edited after the fact.

**m13 [minor; red team] Seed 203 has now decided a gate but was not reserved.** *Response —
fixed (3a1da65):* reserved as a dataset seed and as a fresh-test seed bound to
`configs/iter2/d/plan.json`; every committed plan still validates; tested.

**m14 [minor; red team, reproducibility] Follow-ups from 2b still open and mitigated by hand:
the plan file's committed state and the manifest's `git_commit` are not tool-checked; prediction
headers carry no weights digest; `time-late-not-worse` has no interval.** *Response — recorded:*
both reviewers verified each by hand for this run; listed below. With the project stopping at G2
they are recorded for whoever picks the pipeline up, not scheduled.

**m15 [minor; reproducibility] validation.md gave the shuffled control 904 s/epoch; the manifest
gives 7,265 / 8 = 908.** *Response — the column is the mean increment after epoch 0,
(last − first) / (n − 1), as `tma-scan` reports it (`scan.ts:168`), under which the value is 904
(numerics). The cell was changed to 908 in 3a1da65 and restored to 904 with a footnote defining
the column (round 2, reproducibility).*

**m16 [minor; numerics] The output scale (15 kt, ownship's maximum) is not saturation with a
linear head, but the slope collapse above 15 kt (0.33, against 0.84 below 7 kt) is exactly where
scaled targets exceed 1.** *Response — recorded* with m3: an untried lead, named in the write-up.

**m17 [minor; statistics] One training seed per model: the record cannot separate the lever
effect from initialisation.** *Response — recorded* as a caveat in the no-go statement, not as a
lead.

**m18 [note; red team] The shuffled control's course (77.6° on the σ = 1° gate rows) is closer to
naive than 2b's (70.0°).** *Response — recorded:* bearing-tracking geometry (median |true course − bearing| 39° on
this split), not label information; range 1.027 × naive and speed 4.41 kt against naive 4.44 kt.

**m19 [minor; reproducibility, red team] Both CI runs show conclusion "failure".** *Response —
recorded* under m8: the 345-minute hand-offs.

### Tooling follow-ups (recorded, not scheduled: the project stops at G2)

- Content digests for features files, so training-input lineage is checked by digest after a
  rebuild (m10).
- `tma-g2` checks the plan file is committed and the manifest's `git_commit` against the CI run's
  head (m14; 2b m12).
- Prediction headers record the predicting model's `weights_digest` (m14; 2b m11).
- A paired bootstrap interval for `time-late-not-worse` (m4; 2b m3).
- Cached predictions validated by the truth file's content digest (2b).
- `cpu_model` per job in the manifest, or the job boundaries recorded by `tma-train` (m8).

## Round 2 (2026-10-16)

Brief (`scratchpad/panel2c/round2.md`): are your findings fixed or answered; is the record
accurate about your evidence; is the record sufficient and correct for a no-go decision at G2;
does 3a1da65 introduce a problem? ≤ 300 words.

| Reviewer | Verdict | Remaining |
| --- | --- | --- |
| TMA geometry | approve-with-findings | m1–m5, m11, m16 answered accurately; 3a1da65 verified; corrected its own round-1 wording for the write-up (below) |
| Estimation and numerics | approve-with-findings | m1, m3, m8, m9, m15, m16 answered accurately; job boundaries match the CI logs (LSTM 51 + 23 + 8 epochs; BiLSTM 15 + 10 + 10 + 15 + 24); decomposition re-run, every number reproduces; wording minors (below) |
| Evaluation statistics | approve-with-findings | m4, m6, m7, m17 answered accurately; every verdict-table value recomputed; the no-go statement is a fair rendering; figure and wording minors (below) |
| Reproducibility | approve-with-findings | 3a1da65 touches only validation.md, train-plan.mjs and its test; every committed plan validates and the reservations refuse what they should; m8, m10, m11, m19 accurate; one cosmetic minor (below) |
| Red team | approve-with-findings | Reservation verified from several paths; m11–m14, m18 accurate; the no-go statement scopes saturation correctly; wording minors (below) |

No reviewer rejects; no blocker or major finding is open; all five judge the record sufficient
and correct for a no-go decision at G2. Round-2 minors, all wording or figures in this record or
the write-up, and what was done:

- **[numerics, geometry]** The 2c gain decomposes as ~16% less shrinkage (slope 0.654 → 0.711) but
  only 5–9% less scatter; "each by 10–15%" was loose (the reviewers' own round-1 wording). The
  3.7 × ratio to classical is the > 1°/min bearing-rate band; by range it is 16 × below 3 km.
  The gain by true speed came from the bands away from the population mean (3–9 and 15–18 kt),
  not only slow targets. *Fixed in the write-up.*
- **[geometry]** m5's held-out wording: at zig + 300 s the models beat classical on all three
  quantities there (classical 23% non-converged); at zig + 600 s classical leads on range and
  course while every estimator's speed sits near the naive prior. The σ = 2° robustness triple
  holds at zig + 300 s only. *Fixed in the write-up.*
- **[red team]** The early robustness lead is robustness to classical's non-convergence (scored
  infinite), not to noise: on converged rows at σ = 2° classical's course is the better one.
  The models' median error-to-bound ratio of 1.30 is about 2 × an efficient estimator's 0.67, not
  "1.3 × the bound" as a lay reader would take it. "Each step ~0.3 kt" holds for the
  instantaneous model (time-late −0.61 then −0.24 kt). *Fixed in the write-up.*
- **[statistics]** Naive speed on the gate rows is 4.44 kt (4.36 is the zig + 300 s value); the
  n* sentence in the no-go statement was inverted ("would still exclude 1 kt with as few as about
  80 scenarios"); "levers that already show saturation" overstates the loss-weight lever: the scan
  shows the capacity lever flat (at 30 epochs, weight 1), the loss weight bought 15%. 60.4%, not
  60.5%; shuffled speed 4.41 kt. *Fixed in this record and the write-up.*
- **[reproducibility]** m15 had been "fixed" in the wrong direction: under the column's coded
  definition the shuffled control is 904 s/epoch. *Restored with a footnote (1e9e14a).*
- **[red team]** Residual, as in round 1: a plan file whose path ends `configs/iter2/d/plan.json`
  passes the fresh-test exemption wherever it sits; committed-ness is the m14 follow-up.

**Decision.** Round 2 approved with minors only (constitution 1.2.0: no rejection, no open blocker
or major). `verdict.json` `decided_by` is set to this round: **G2 FAIL**. Iteration 2c was the
last the SRD allows under G2 (§7, amended 2026-10-15); the project stops at G2 with a no-go on the
SRD's question for speed, and a pass on range and course. Nothing under
`experiments/20261016-i2d-g2/` other than this file and `decided_by` changed after scoring.
