# G8 review: phase 10, T2's range with the fused tracker's velocity (spec 022, decision 38)

**Judged:**
`hybrid-lstm-gaussian-fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6-c180`.
- **The reference:** the `-g1` IMM.
- **The estimator to beat on range:** the frozen `-g1` fused tracker.
- **The data:** seed 224's 40,000-scenario test split with realistic bearing error, giving 67,292
  G5 rows in 20,161 scenarios.

The machine verdict is **pass**, and every 97.5% interval is wholly within its limit:

| Check | Ratio | 97.5% CI | Limit |
| --- | --- | --- | --- |
| Range / IMM | 0.689 | [0.675, 0.702] | < 1 |
| Course / IMM | 0.895 | [0.885, 0.906] | < 1 |
| Settled range / IMM | 0.724 | [0.703, 0.746] | < 1.1 |
| Settled course / IMM | 0.887 | [0.870, 0.905] | < 1.1 |
| Settled speed / IMM | 0.898 | [0.878, 0.918] | < 1.1 |
| Range / fused tracker (g8-range-vs-network) | 0.908 | [0.893, 0.921] | < 1 |

## Round 1 (five independent reviewers, read-only)

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 2 | 3 |
| Estimation and numerics | approve-with-findings | 0 | 3 | 2 |
| Evaluation statistics | approve-with-findings | 0 | 2 | 3 |
| Reproducibility | approve-with-findings | 0 | 0 | 3 |
| Red team | approve-with-findings | 0 | 2 | 5 |

All five agree that **pass** is the correct machine verdict. None found leakage or a break in
pre-registration.

- **Commit order.** §C.17 and spec 022 (5bede76) came before validation. Decision 38 (3a23e90,
  20:53Z) came before the data, which were written at 20:54Z, clean, at 3a23e90. The verdict came
  after that.
- **Scored once.** The hybrid, the IMM and the beaten fused file were each recomputed byte for byte
  on the 200-scenario sample.
- **Reproduction.** The reproducibility reviewer verified all 8 hashes and every plan digest, and
  found `dist` byte-identical to source. Re-running the gate with `--repeat-of` gave a
  byte-identical `verdict.json`, and a `scoring.json` that differs only by `repeat_of`.
- **Independent checks.** Geometry rebuilt every expected hybrid row on 600 scenarios (73,576 rows)
  with no mismatches, and confirmed the realistic error in the scored bearings (variance/σ² median
  1.45, lag-1 ρ 0.24). Estimation recomputed every point ratio exactly.

### Major findings and responses

| # | Finding (reviewers) | Response |
| --- | --- | --- |
| M1 | **The pass carries little new information.** The hybrid's range is T2's on every G5 row (0 differences), so g8-range-vs-network is T2/fused. Phase 7 already showed that on a scored test split (fused/T2 1.095, so T2/fused 0.913), and phase 8 could not close it. The velocity is the fused tracker's, which passed G5 in phase 7. The estimator to beat moved from T2 (phases 8–9, unbeaten) to the fused tracker, which is beatable by construction. What is new is only that the pair passes every G5 check at once. (statistics, red team, estimation, geometry) | **Agreed. Stated plainly** in the blog ("Why this is mostly a replay"), §C.17's outcome and AGENTS.md. The change in the estimator to beat was the owner's 2026-11-12 choice, made before validation (§C.17), and its predictability is now on the record. |
| M2 | **Baselines were missing** (`baselines.json`, `lsq.json`). (statistics, red team) | **Fixed.** They were added before the write-up (915956e): naive, batch least squares, the EKF, T2 and the fused tracker on the same rows. The EKF is better on settled course (fused/EKF 1.25) and speed. Batch least squares is best before any manoeuvre (7.3%, 2.2°). The hybrid beats the EKF on overall range (0.72) and course (0.88). |
| M3 | **The non-converged = +∞ convention moves each ratio about 1 pp in the hybrid's favour.** The IMM has 736 non-converged rows and the fused tracker 618; the hybrid has none, because it falls back to T2. (estimation; statistics and geometry as minor) | **Reported** in `convergence.json` (`scripts/research/spec022-convergence.mjs`). On the 66,445 rows where all four estimators converged, range is 0.700 against the IMM and 0.918 against the fused tracker, and course is 0.912 against the IMM. Every check still passes. The convention was G5's from the start and was pre-registered. |
| M4 | **The implied state is incoherent.** The 60 s kinematic gap is median 18.2 kt, P90 44.8 kt, against 7.9 kt for the fused tracker. Position bearing error is 0.99°, against 0.69° for the fused tracker. The implied bearing rate is the worst of the four estimators (0.358°/min). The hybrid is per-output estimates, not a track. (geometry; estimation as part of M3's "does not show") | **Agreed. Reported** in `coherence.txt` (`scripts/research/spec022-coherence.mjs`, the geometry reviewer's script, re-run here with identical figures) and in the write-ups. T2 alone also shows a 16.8 kt gap: the incoherence comes largely from T2's position track. |

Every write-up also states what the pass does not show:
- no range gain over T2;
- T2 is better on overall course (1.02 ×);
- the EKF is better on settled course and speed;
- there is no stated uncertainty;
- it covers one error model.

### Minor findings and responses

- **Composition** (geometry, red team, statistics). Where the fused tracker is not converged, the
  hybrid's row is T2's, velocity included: 618 of 67,292 G5 rows (0.9%), and 2.5% of all rows in
  the 600-scenario sample. T2 converged on every row, so the "T2 not converged" branch never
  applies. The write-ups say so.
- **`report.json` was missing** (reproducibility). A container restart interrupted the original run
  after `verdict.json` and `scoring.json` were written, and before `report.json`. The committed
  `report.json` is the one from the reproducibility reviewer's `--repeat-of` run on the same
  inputs and code, whose `verdict.json` is byte-identical to the committed one.
- **`predictions.sha256` timing** (red team, reproducibility). It was written after the restart, from
  the files the gate used. Its mtime and all 8 hashes are consistent with that, and it was
  committed complete in c108b95.
- **Coverage** (statistics). Only the 20,161 scenarios with σ = 1° contribute G5 rows.
- **The θ = 180 edge case changes nothing** (red team): `wrapAbs` is at most π, and the test is a
  strict `>`. A tested case covers it.
- **`sample_sha256` is the same for every estimator** (red team, estimation). It hashes the
  sampled scenario indices, not the rows, so this is expected.
- **The digest pin** (red team, statistics) was taken from a dirty tree before the decision and
  deleted unused. It is disclosed in `decision.md`.
- **`decided_by`** is set once the panel closes.
