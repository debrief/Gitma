# G5 review: phase 4b tracker hybrid on seed 213 (decision 30)

Agent review panel (constitution 1.2.0): five independent read-only reviewers, one per speciality.
Harness result: pass, all five gated checks (`verdict.json`); record `g5.md`.

## Round 1

### TMA geometry

VERDICT: approve-with-findings

[major] Settled-range pass hides a 37–57% range regression in the easiest geometry: held course 6.34% vs IMM 4.03% (1.57×; EKF 3.68%); settled zig+5 min 5.62% vs 4.10% (1.37×); late settled rows win (zig+15 8.8 vs 10.6; zig+20 10.7 vs 14.8). Pooled 1.022 averages two regimes (before any manoeuvre: T2 loses; after one: IMM degraded). Held P90s equal (17.9 vs 18.1). Not a gate violation (pre-registered; Annex C §C.10 flags it); the write-up and verdict detail must report held-course and zig+5 ratios beside the pass.

[major, interpretation] T2's range with the IMM's velocity is not a consistent track state: the implied bearing rate (cross-LOS relative velocity / range) is off by roughly the ratio of the two ranges (~8% median). rowError scores marginals, so G5 cannot see it. Describe the hybrid as a per-row report of three separately estimated quantities, not a tracker state; optionally report predicted-vs-observed bearing-rate mismatch.

[minor] Switch rule geometrically sensible and does little harm: held course 3.89° vs 3.875°, speed 0.705 vs 0.697 kt; after manoeuvres course improves (2 turns 32.3 vs 35.7; 3 turns 39.8 vs 45.0).
[minor] IMM-non-converged rows go to T2 (hybrid.ts:77): 147 rows (0.22%) — part of the −3.4 pp gross difference is definitional.
[minor] settledRow (gate-g5.ts:47-54) is causal but 5 min is short for bearings-only recovery; split settled into before-any-manoeuvre vs after-a-manoeuvre in report.json.
Nothing in the geometry makes the pass misleading beyond the above; wins come from multi-turn and late rows (3 turns: range 9.6 vs 13.3%, course 39.8 vs 45.0°).

### Estimation and numerics

VERDICT: approve-with-findings
Hybrid code correct: wrapping via atan2 (tests 350° vs 20°, 44/46° boundary), non-converged handling (IMM non-converged → T2 velocity; T2 non-converged → IMM row, 0 cases on seed 213), sd fields consistent, timestamps/index/mode checked.
[major] Pass holds against the IMM only; against the EKF the hybrid fails settled course (1.44×) and speed (1.21×); settled range 1.07×. IMM choice legitimate (frozen on validation by overall median range, decision 29), but the write-up must say so plainly.
[major] Nothing ties the hybrid prediction file to the frozen weights: requireFrozenModels hashes --model dirs; the hybrid file is matched only by estimator name. Regenerate T2 predictions → tma-hybrid-track → compare SHA-256, or record input digests (follow-up), like the tma-g3 gap.
[minor] Research script drops non-converged rows; gate scores them Infinity and the hybrid takes T2 (147 rows, 0.22%); θ unchanged.
[minor] Streaming change cannot alter predictions (same batch size, order, canonicalJson, atomic rename).
[minor] Fragility: overall course binding (0.904, upper 0.9155); settled range is T2 alone (1.022 [0.990, 1.060]); settled course/speed pass largely by construction (~13% T2 velocity); below θ≈25° settled speed fails; absolute errors are large (settled course P90 47°, overall course median 20°) — quote them.
[minor] velocity_from_network count can be slightly high (equality test), cosmetic.

### Evaluation statistics

VERDICT: approve-with-findings
Mechanics correct: paired scenario-clustered bootstrap (bootstrap.ts:461), pass rule (gate-g3.ts:48 judge), 66,617 rows / 19,920 scenarios (settled 29,706 / 15,631); every gated upper bound inside its limit; commit order 280d276 (data) → 3dd8c29 (decision, pin) → e5307f8 (output), e13c263 streaming only. 97.5% conservative, acceptable; conjunction needs no further correction; one G5 test seed spent across phases 4/4b.
[minor] "declared before the choice" not verifiable from git (criterion and θ result in the same commit 280d276); the fresh seed decides, so validity unaffected; do not overclaim ordering.
[minor] re-score clause slightly inflates false-pass rate; not triggered.
θ-dependent checks did not shrink val→test (course 0.897→0.904, settled course 0.982→0.980, speed 0.991→0.994): no sign of overfitting θ.
[minor] settled range 0.973→1.022 missed the forecast band 0.95–1.02; θ-independent (range is T2's); ~1.6 combined SE, seed variation; record the miss and state T2's settled range is slightly worse than the IMM's, passing via the 10% allowance.
[minor] IMM non-converged rows (+Infinity: 147 overall, 53 settled) slightly favour the hybrid; negligible; disclose.
[minor] EKF beats IMM on settled (course 4.96 vs hybrid 7.15°, speed 1.10 vs 1.34 kt); write-up should say straight-leg velocity is 1.2–1.4× the EKF's.
[minor] verdict.json reported-only line "inconclusive" for overall speed may be misread; note in review.md.
[minor] batch least squares promised in C.10 is not in report.json; add before the write-up.

### Reproducibility

VERDICT: approve-with-findings
Reproduced at e5307f8 (clean tree): (1) check-digests configs/phase4/h/plan.json data/p4h all ok; test pinned 0b128866…, header seed 213 [360000, 400000), generator_git_commit 3dd8c29, dirty false. (2) T2 file SHA-256s match decision model_digests. (3) Test hybrid rebuilt byte-identical (SHA-256 1a94895f…; 4,929,538 rows, 782,642 velocity from T2); validation hybrid byte-identical too. (4) spec013-hybrid.mjs reproduces all 30 rules in rules.json, 0 mismatches; θ = 45° is the arg-max (0.097 vs 0.094 at 40°, 0.080 at 50°). (5) Gate refuses a test split without bindings, as designed (bootstrap not re-run).
Ordering: decision 3dd8c29 15:32:04Z; all test artefacts later (test 15:34, IMM 15:45, EKF 15:51, naive 16:04, T2 16:28, hybrid 16:29); 3dd8c29..e5307f8 touches only the streaming change (e13c263).
[minor] T2 test predictions not independently reproduced: re-run with --train accepted ("headers identical apart from provenance") but failed after 23m54s with ENOSPC (output 1.3 GB). Record the exact predict command incl. --train; confirm T2's bytes on a machine with disk.
[minor] decided_at 16:30Z is after the scoring; the decision was committed 15:32:04Z; correct it.
[minor] data/p4h/gen.log is stale (failed fresh attempt, no log of the successful run).
[minor] Validation figures come from two populations: research script 16,463 rows (drops non-converged), tma-g5 16,500 rows; decision.md quotes 0.847/0.897 (tma-g5), rules.json/research.md 0.848/0.903 at 45°.
[minor] Test data materialised before the decision commit, as digest pinning requires; nothing scored before it.

### Red team

VERDICT: approve-with-findings
Holds: (a) causality — T2 model_kind instantaneous, one-way LSTMs (architectures.ts:90-94), bearing-rate over trailing 18 rows (derived.ts), truth only in targets (layout.ts:84-120); rule reads same-timestamp rows only. (b) θ bound via estimator name (c45), CLI default 45, carried_models exact match (cli-g5.ts:82-86). (c) Timeline 280d276 → 3dd8c29 (decision, pin) → e13c263 → e5307f8; first touch of seed 213 after the decision; seed 212 unscored.
[major] Held-course range regression: hybrid (= T2) 6.34% vs IMM 4.03% (1.57×), EKF 3.68% (1.72×); diluted in the settled check by post-manoeuvre wins; visible on validation (5.78 vs 4.05); research.md omits the IMM's figure. Report it.
[major] Settled velocity checks pass largely by copying the IMM (~87% of rows), and the IMM is weak there: vs the EKF the hybrid would fail settled course (1.44×) and speed (1.21×). IMM frozen fairly (decision 29). Claim must read "T2's range plus the IMM's velocity beats the IMM on overall range and course", not "better than a tuned tracker on straight legs".
[major] Provenance: g5 folder lacks manifest/run.sh/log/seeds/predictions.sha256 (cf. 20261028-i5-g3); prediction files are accepted on their header estimator string. Commit commands, scoring commit and prediction SHA-256s; regenerate a subset of T2/IMM predictions and compare bytes.
[minor] e13c263 changed cli-predict after the decision; show T2 output byte-identical to the committed validation predictions.
[minor] decision.json decided_at 16:30Z but committed 15:32Z; cosmetic.
[minor] θ criterion "declared before the choice" not git-verifiable (same commit 280d276).
[minor] Annex C §C.5 says "all six gated checks"; the table gates five.
[minor] IMM non-converged rows (147) slightly favour the hybrid on gross errors.
Recommendation: accept the pass as pre-registered, reported strictly as a hybrid; disclose held-course regression and EKF comparison; commit provenance before decided_by.

## Responses to round 1

No reviewer rejected and none raised a blocker. Every major and minor finding is answered below; the
majors are about what the pass may be said to show, and are answered with evidence and disclosure in
`g5.md` (the gate record) and the write-up.

**Majors**
1. **Held-course and pre-manoeuvre range regression** (geometry, red team). Accepted and disclosed.
   `settled-slices.json` (`scripts/research/spec013-slices.mjs`) splits settled rows: before any
   manoeuvre the hybrid's range is 6.0% against the IMM's 4.1% (1.47 ×; EKF 3.7%); after a manoeuvre
   10.3% against 15.2% (0.68 ×). Held course: 6.3% against 4.0%. `g5.md` reports these beside the pass
   and states that the commonest case, a target holding course, is better served by a tuned filter.
2. **Not a consistent track state** (geometry). Accepted. `g5.md` and the write-up describe the hybrid
   as three separately estimated quantities per row and state that its range/velocity pair does not
   satisfy either estimator's bearing-rate relation. A bearing-rate consistency diagnostic is noted as
   a follow-up, not computed here.
3. **Against the EKF the hybrid fails two settled checks** (numerics, red team; statistics minor).
   Accepted and disclosed: settled course 1.44 ×, speed 1.21 ×, range 1.07 × the EKF; overall 0.83 ×
   and 0.75 ×. The IMM was frozen fairly by decision 29 before this gate; the claim is worded as
   "T2's range plus the IMM's velocity beats the IMM overall", never "better than a tuned tracker on
   straight legs". The settled velocity checks passing largely by construction (84% IMM velocity) is
   stated.
4. **Provenance of the prediction files** (numerics, red team). Fixed with evidence:
   - `run.sh` (commands in order, including `--train` for T2) and `predictions.sha256` committed.
   - T2's seed-213 predictions regenerated from the digest-checked weights: **byte-identical** to the
     scored file (fed1c535…). The hybrid rebuilt from them: **byte-identical** (1a94895f…).
   - The reproducibility reviewer independently rebuilt the hybrid from the IMM and T2 files
     (byte-identical) and confirmed the plan digests and model digests.
   - Recording input digests inside a hybrid file, so `tma-g5` can check them, is a follow-up (as for
     `tma-g3`).

**Minors**
- **Streaming change after the decision** (red team): T2's seed-211 validation predictions written by
  the new code are byte-identical to the file the old code wrote; naive was checked too.
- **T2 test predictions not reproduced** (reproducibility, ENOSPC): reproduced here after freeing disk
  (above).
- **`decided_at`** (red team, reproducibility): 16:30:00Z is wrong; the decision was committed at
  15:32:04Z, before any test prediction. The committed decision is left unchanged so that it stays
  the record bound by `tma-g5`; the correction is recorded here and in `g5.md`.
- **"Declared before the choice" not verifiable from git** (statistics, red team): accepted; the
  criterion and θ arrived in one commit (280d276). The write-up does not claim more order than git
  shows; the fresh seed is the control.
- **Two validation populations** (reproducibility): the research script drops non-converged rows
  (16,463 rows), `tma-g5` scores them as infinite (16,500). decision.md quotes `tma-g5`'s figures; the
  difference is ≤ 0.006 in any ratio.
- **IMM non-converged rows** (geometry, numerics, statistics, red team): 147 rows (0.22%); disclosed in
  `g5.md`; negligible on medians.
- **Batch least squares** promised by Annex C §C.10 (statistics): computed on the same 66,617 rows
  (`lsq.json`): 11.8% overall, 6.6% settled, better than the hybrid on settled range; disclosed.
- **Settled range missed the forecast band** (statistics): recorded in `g5.md`; θ-independent.
- **Reported-only "inconclusive" row** in `verdict.json` (statistics): labelled in `g5.md`.
- **Annex C §C.5 "six gated checks"** (red team): corrected to five.
- **`settledRow` and the 5 min window** (geometry): the definition is pinned by Annex C and unchanged;
  the before/after split above gives the recovery picture.
- **`gen.log`** (reproducibility): a local file, not committed; the committed record is `run.sh`, the
  pinned digest and the clean test header.
- **Re-score clause** (statistics): not triggered.
- **`velocity_from_network` count** (numerics): cosmetic; noted.

## Round 2

### TMA geometry

VERDICT: approve-with-findings
Both round-1 majors addressed. (1) Pre-manoeuvre regression disclosed (settled before any manoeuvre 6.0% vs IMM 4.1%, 1.47×; after 10.3% vs 15.2%, 0.68×). Make explicit that the before-manoeuvre rows are the larger share of the settled population (55%) and the pooled check passes only because post-manoeuvre rows carry it. Velocity before any manoeuvre is effectively the IMM's (4.0°, 0.70 kt for both). (2) Track-state inconsistency described (g5.md:6, :66); bearing-rate diagnostic as follow-up acceptable. Minors addressed.
[minor] Keep the claim as "T2's range plus the IMM's velocity beats the IMM overall"; the EKF (settled course 1.44×, speed 1.21×) and batch least squares (6.6% settled range) both beat it on straight legs; the write-up must not suggest otherwise.

### Estimation and numerics

VERDICT: approve
Major 2 (hybrid file provenance) addressed: T2 regeneration byte-identical (fed1c535…), hybrid rebuild byte-identical (1a94895f…), independently confirmed by reproducibility; run.sh and predictions.sha256 committed; tma-g5 input-digest check is a recorded follow-up (as tma-g3), not blocking. Major 1 (EKF) addressed in g5.md with figures and claim wording. Minors answered.
[note] "84% of rows" counts all per-timestep rows; on G5 rows the IMM-velocity share is ~87% (13.4% T2 on validation) — say which population.
[note] decided_by must be set when the panel closes.

### Evaluation statistics

VERDICT: approve
All round-1 findings addressed (ordering claim scoped; forecast miss recorded with θ-independence and 1.6 SE; IMM non-converged disclosed; EKF comparison and claim scope; reported-only rows labelled; batch least squares added on the same rows).
[minor] Pooled settled range (1.022) mixes two regimes (1.47× before any manoeuvre, 0.68× after); disclosed; the pre-registered statistic is pooled, so the gate stands; a future gate should consider a separate before-manoeuvre check.
[minor] "84% IMM velocity" is over all per-timestep rows (782,642 of 4,929,538); validation's 13% is over G5 rows; state the population or give the seed-213 G5-row share.
[minor] decided_by must be set from "harness (pending agent panel review)" to the approving round.
No remaining or new blocker or major on statistical grounds.

### Reproducibility

VERDICT: approve
sha256sum -c predictions.sha256: all seven files OK (test.t2 fed1c535…, test.hybrid 1a94895f… = the round-1 rebuild); test.f32pack 5bbd9fb1… equals T2's prediction-header dataset_digest. run.sh records the predict command with --train and the full chain. decided_at correction recorded (g5.md, review.md); leaving decision.json unchanged is reasonable. gen.log answer acceptable. Two validation populations explained (≤ 0.006 in any ratio). Changes after e5307f8 are evidence and records only; no gate, hybrid or model code changed.
[minor] Neither the hybrid file nor tma-g5 checks its IMM and T2 input digests; acknowledged follow-up, as for tma-g3.

### Red team

VERDICT: approve
All three round-1 majors addressed: pre-manoeuvre regression quantified and disclosed (settled before any manoeuvre 6.01% vs IMM 4.10%, EKF 3.7%; after 10.29% vs 15.15%); EKF comparison and the "by construction" point disclosed with the claim worded "T2's range plus the IMM's velocity beats the IMM overall"; provenance — run.sh, predictions.sha256, T2 regeneration and hybrid rebuild byte-identical, independent rebuild, streamed predictor byte-identical. tma-g5 accepting files on their estimator name is a reasonable follow-up.
[minor] g5.md says the test header records commit 3dd8c29 while the decision says the split was generated at 280d276: state that the plan's data step regenerated it at the decision commit with the same content digest (0b128866…; file SHA-256 5bbd9fb1…).
[minor] decided_at left in decision.json, corrected in review.md and g5.md: acceptable.
[minor] decided_by must be set to the approving round.

## Outcome

Round 2: four reviewers approve and one approves with minor findings. None rejects, and no blocker or
major finding is open. **G5 passes for the hybrid, decided by the agent review panel, round 2.**

Round-2 minors, all addressed in `g5.md` without changing any result:
- The before-manoeuvre rows are 55% of settled rows, and the pooled settled-range check passes only
  because post-manoeuvre rows carry it (geometry, statistics).
- The 84% IMM-velocity share is over all per-timestep rows; on validation's G5 rows the T2 share was
  13% (statistics, numerics).
- The test header's commit (3dd8c29) is the data step's regeneration at the decision commit, with the
  same content digest (red team).
- The claim stays "T2's range plus the IMM's velocity beats the IMM overall"; the EKF and batch least
  squares are better on straight legs (geometry).
- `tma-g5` checking prediction-file input digests is a follow-up, as for `tma-g3` (reproducibility,
  red team, numerics).
- A future gate should consider a separate check on settled rows before any manoeuvre (statistics).
