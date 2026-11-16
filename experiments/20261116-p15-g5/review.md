# G5 review: phase 15, T2's range fused into the EKF (spec 028, decision 43)

**Judged:** `fused-lstm-gaussian-ekf-sa0.07-p16-r64-g1-k4-m3` against the re-tuned EKF
`ekf-sa0.03-p16-r64-g1` (SRD Annex F; reference by Annex F §F.3's rule). **Data:** seed 233, a
40,000-scenario test split with realistic bearing error (phase-7 ranges, ×1).

The machine verdict is **pass**: every gated check is wholly within its limit.

| EKF-fused / re-tuned EKF (97.5% CI) | Ratio | Limit |
| --- | --- | --- |
| Overall range | 0.782 [0.767, 0.795] | < 1 |
| Overall course | 0.819 [0.809, 0.830] | < 1 |
| Settled range | 0.837 [0.814, 0.860] | < 1.1 |
| Settled course | 1.043 [1.013, 1.078] | < 1.1 |
| Settled speed | 0.973 [0.947, 1.001] | < 1.1 |

**Forecast before scoring** (decision 43): P(pass) about 10%. Validation's settled course was
1.083 [0.997, 1.169]; test is 1.043.

## Round 1 (five independent reviewers, read-only)

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 3 | 2 |
| Estimation and numerics | approve-with-findings | 0 | 2 | 3 |
| Evaluation statistics | approve-with-findings | 0 | 2 | 5 |
| Reproducibility | approve-with-findings | 0 | 0 | 4 |
| Red team | approve-with-findings | 0 | 3 | 5 |

All five agree that **pass** is the correct machine verdict under the pre-registered rules. None
found leakage, a break in pre-registration, or a way round the bindings. Every major finding is
about what the pass may be said to mean.

- **Independent recomputation** (geometry, reproducibility). Each wrote its own row selection,
  settled rule and error formulas: 66,387 rows in 19,868 scenarios (29,599 settled), all five
  ratios equal to `verdict.json` within 1e-15.
- **Full re-computation** (reproducibility, red team). The reference EKF and the fused tracker,
  re-run over all 40,000 scenarios, are byte-identical to the scored files (86ccb106…,
  e82156f9…), not just the 200-scenario binding sample. A rebuild of `packages/` from HEAD
  differs from `dist/` only in source-map comments.
- **Provenance** (reproducibility, red team, statistics). The test split was generated clean at
  9dbb202, the decision commit, 40,000 scenarios of seed 233 with the phase-7 ranges; plan digests
  hold; nothing under `packages/` or `scripts/` changed after the decision. The pre-registration
  order is 65666f4 (Annex F, grid, score) → 9dbb202 (validation, decision 43, plan, run.sh) →
  data → 49f3192 (verdict).
- **The restart** (all). A container restart lost T2's and naive's prediction files and
  `report.json` after `verdict.json` and `scoring.json` were written. T2 was regenerated; its
  SHA-256 equals the input digest the fused file recorded before the restart (4b85873b), and its
  weights digest equals decision 43's. `report.json` comes from `--repeat-of`
  (`experiments/20261116-p15-g5-r/`), whose `verdict.json` and `report.json` are byte-identical
  to this folder's; its `scoring.json` differs only by `repeat_of`.
- **The code** (estimation, geometry, red team). `ekfRangeUpdate`'s Jacobian, innovation and
  Joseph form are correct; the update is radial; the hook is causal. The IMM fusion's refactor is
  behaviour-preserving: on seed 217 it reproduces Annex E's committed file (8ec102e2…).

### Major findings and responses

| # | Finding (reviewers) | Response |
| --- | --- | --- |
| M1 | **Part of the overall-course gain is σa, not the network.** The reference's σa 0.03 was tuned on median range (Annex E). A plain EKF at σa 0.07 (no network) on seed 233 is 0.888 × the reference on overall course but **fails** overall range (1.027) and settled course (1.123). Adding T2 to that same EKF gives range 0.76 ×, course 0.92 ×, settled course 0.93 ×, after-manoeuvre range 0.67 ×. About half the 0.819 course ratio is σa; the range gain is the network's alone. (estimation, red team, statistics) | **Agreed; stated.** The control is post hoc and reported, not gated. Every write-up says "beats the range-tuned re-tuned EKF", gives the σa-0.07 control, and credits the range gain to T2 and half the course gain to σa. The network is needed for the pass: no plain-EKF σa satisfies all five checks. |
| M2 | **Settled rows pool two opposite regimes.** Before any manoeuvre (16,318 rows) fused/EKF course is 1.57 [1.52, 1.63], speed 1.32, range 1.10 [1.05, 1.14]; held course 1.69. After a manoeuvre, course 0.67. The pass depends on the mix: settled course crosses 1.1 at a before-manoeuvre share of about 0.6 (test 0.55). Least squares on straight legs: 7.35%, 2.2°. Decision 43's sentence "within 1.1 × of it after a manoeuvre" misdescribes the check. (geometry, statistics, red team, estimation) | **Agreed; stated, with the split.** The pooling is Annex C §C.5's, applied at every G5, so the verdict stands. The results page and blog give both regimes, the crossing share, and least squares. The decision record is not edited (it is pre-registration); this review records the correction: the settled check pools rows before and after any manoeuvre. |
| M3 | **On long straight legs and at close range, T2's range hurts.** Before any manoeuvre fused/EKF range rises with time since the turn (1.01 at zig + 5 min, 1.40 at + 20) and is 2.0 × under 5 km. T2's errors are correlated (0.97 at one fusion interval, 0.77 at 300 s) and its stated sd is about 1.2–1.26 × too small, so k 4, M 3 is about 2 × overconfident by zig + 20 min. (geometry, estimation) | **Agreed; stated** as the limit of a fixed-weight range aid. The fused tracker's covariance is not claimed calibrated (no G7 claim). A weight that falls once bearings fix range is the obvious next design; not tried. |
| M4 | **Only the EKF is gated; "beats both re-tuned references" is not shown on test.** Against the re-tuned IMM, overall course is 0.991 [0.976, 1.005]. (red team, statistics) | **Agreed; stated.** The write-ups say "beats the re-tuned EKF at G5"; against the IMM, range 0.81 × [0.79, 0.82] and speed 0.83 ×, course not shown better. Annex E §E.5's pass wording is not reused. |
| M5 | **The "settled after" rows are recovery rows for a σa-0.03 EKF.** 300–600 s after a manoeuvre the reference's course error is still 36°; it recovers only beyond 900 s (11.9° against 11.0°). (geometry) | **Agreed; stated.** The settled checks are not described as straight-leg accuracy for this comparison. |

### Minor findings and responses

- **T2 alone** is better on overall range (fused/T2 1.064) and overall course (1.113); the fusion
  wins on speed (0.74) and settled course (0.52). Stated.
- **Annex E's IMM fusion** is level on range (1.010 [0.999, 1.019]) and better on overall course
  (fused-EKF/fused-IMM 1.048 [1.035, 1.061]); the EKF fusion is better on settled course (0.83)
  and speed (0.93). Stated as a trade, not an improvement.
- **The forecast miss** (statistics, red team). 1.083 → 1.043 is about one combined standard error;
  ranking was driven mostly by the deterministic trade with IMM course, so selection inflation on
  this check was small; the 10% forecast was too pessimistic (about 30% without selection).
  Settled course is significantly *worse* than the EKF's (interval above 1); it passes the 10%
  non-inferiority margin only.
- **The digest pin** was generated twice before the decision (19:16:58–19:17:42Z, decided
  19:18:10Z), the second time with the plan's own heldout ranges to match `train-plan.mjs`
  exactly; same digest. About 20 s each, nothing else run. The plan moved from `configs/phase15/a`
  to `configs/phase4/x` before its first commit because seed 211 plans must live there. Future
  pins could be taken after the decision commit.
- **`predictions.sha256`** hashes the regenerated T2 and naive files, not the first run's; T2 is
  identical by the header digest, and naive recomputes identically. `report.json` here is a copy
  from the `-r` run. The recovery commands are in `experiments/20261116-p15-g5-r/README.md`.
- **`sample_sha256`** in `scoring.json` hashes the sampled scenario indices, so both estimators
  share it. Not new; the field name misleads.
- **`fresh_test_count` 400000** names the generation, whose test split is 40,000. Not new.
- **Forking paths.** Annex F was designed after Annex E's validation; seed 217 has served nine
  selections. That shapes which design reached test, not the test's false-pass rate (at most about
  2.5% per look). Across the project the error rate is not controlled; stated.
- **No ρ² → 0 guard** in `ekfRangeUpdate`: NaN is caught by `plausibleState` and re-initialised.
- **Non-converged rows** 322 (fused) against 478 (EKF); gross-error rate 5.98% against 11.73%.

## Round 2

All five reviewers re-read the responses and the write-ups at 5ce8e70.

| Reviewer | Verdict | Open |
| --- | --- | --- |
| TMA geometry | approve-with-findings | 2 minor |
| Estimation and numerics | approve-with-findings | 3 minor |
| Evaluation statistics | approve | 2 minor |
| Reproducibility | approve | none |
| Red team | approve-with-findings | 2 minor |

M1–M5 are closed. Geometry and the red team checked every figure in the write-ups against their own
recomputations. No reviewer rejects, and no blocker or major finding is open. "About half the
course gain is σa" was checked as ln 0.888 / ln 0.819 ≈ 0.59.

The minors were fixed as follows:
- **The blog names the range-tuned EKF** in its title and closing paragraph, and says the IMM is
  not beaten on course (red team, statistics).
- **The settled check's wording.** The blog calls it "settled rows (pooled before and after
  manoeuvres)" and says it is significantly worse than the EKF but within the margin (red team,
  geometry). The go/no-go table's column reads "before any manoeuvre", not "straight legs"
  (geometry).
- **The σa-0.07 control is labelled post hoc** on the results page, in §F.6 and in the blog
  (statistics).
- **Calibration.** Go/no-go condition 5 now attributes NEES 1.1 to the IMM fusion and says the EKF
  fusion's covariance was not evaluated and is about 2 × overconfident; §F.6 adds the same clause;
  T2's sd shortfall is given as about 1.2–1.26 × (estimation).
- **`decided_by`** is set now that the round has approved.
