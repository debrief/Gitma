# G7 re-score review (phase 6, spec 018, decision 34)

This is the one re-score that SRD Annex C §C.13 and C.5 allow after seed 215's inconclusive G7
(`experiments/20261106-p6u-g7/`). Decision 34 kept the tracker, the reference, the frozen models,
the frozen multipliers and the rules. It used fresh seed 216 with a 110,000-scenario test split.

The machine verdict is **pass**:
- **Fused log-range 50% coverage** is 48.62% [48.33, 48.91] on 184,667 G5 rows in 55,156
  scenarios.
- **The other eight gated checks pass.** The median 90% widths are 0.731 / 0.944 / 0.888 of the
  IMM's.

## Round 1 (five independent reviewers, read-only)

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 0 | 3 |
| Estimation and numerics | approve-with-findings | 0 | 2 | 2 |
| Evaluation statistics | approve-with-findings | 0 | 1 | 3 |
| Reproducibility | approve-with-findings | 0 | 0 | 2 |
| Red team | approve-with-findings | 0 | 1 | 3 |

All five agree that **pass** is the correct machine verdict under the pre-registered rules. None
found leakage or a break in pre-registration.

What the reviewers verified:
- **Geometry: an independent recomputation.** The reviewer streamed all 110,000 scenarios with
  code of its own and got 184,667 rows in 55,156 clusters.
  - `g7Rows` matches G5's rows exactly, field by field: index, k, cluster, range, course and speed.
  - The reviewer reproduced all nine gated values exactly.
  - The stored course and speed agree with central differences of the target track to within
    0.004° and 0.0003 m/s.
  - The IMM's x and y estimates are consistent with `range_m`.
- **Estimation: nothing changed but `tma-g7`.** Decision 34's calibrations, reference, carried
  names and model digests are field-for-field identical to decision 33's. Since decision 33
  (baead22), `git diff` under `packages/` touches only `eval/src/cli-g7.ts`, `eval/src/gate-g7.ts`
  and their tests. `requireG7Rescore` enforces this.
- **Red team: the commit order.**
  - 6bdf735 adds the streaming `tma-g7` and the re-score binding.
  - ada7b5a adds the plan, with its digest still a placeholder.
  - 78c0234 adds decision 34 and the pinned digest.
  - a8706f7 adds run.sh. The scored data were generated here, on a clean tree that descends from the
    decision.

  There is one scoring. regimes.json for seeds 215 and 216 differs by no more than 1 pp anywhere.
- **Reproducibility.** All five SHA-256s in `predictions.sha256` verify, and every plan content
  digest checks. The test header is clean at a8706f7, which descends from 78c0234 (decision 34).
  Re-running step 4 with `--repeat-of` (891 s) gave a `checks` array byte-identical to the
  committed one. `scoring.json` differs only by `repeat_of`, and the 200-scenario sample hash is the
  same.

### Major findings and responses

| # | Finding (reviewers) | Response |
| --- | --- | --- |
| M1 | **Log-range 50% intervals under-cover.** The 95% CI [48.33, 48.91] excludes 50%. Pooling seeds 215 and 216 by inverse variance gives about 48.5% [48.3, 48.8], so the intervals are systematically about 1.5 pp low. The pass rests on the ±2 pp tolerance, not on calibration. The IMM's log-range coverage, fitted on the same seed-211 validation, lands on nominal (49.54% and 50.11%). Validation reuse alone therefore does not explain the fused shortfall. (estimation, statistics, red team) | **Agreed. The claim is stated as "pooled coverage within tolerance, biased about 1.5 pp low", never "calibrated".** It is worded that way in SRD Annex C §C.13, AGENTS.md, the fused-tracker note, the glossary and the blog post (`site/blog/2026-11-07-phase-6-rescore.md`). The validation-reuse explanation from seed 215's M3 is weakened accordingly. |
| M2 | **The regime split repeats on seed 216.** Fused log-range 50% coverage is 66.7% on settled rows before any manoeuvre and 38.7% after one, 61.2% at zig + 5 min and 39.6% at zig + 20 min. Course 50% is 76.2% on settled rows and 30.2% on unsettled ones. The pass holds on the pooled G5 row mix only. (estimation, statistics; geometry as a minor) | **Agreed, and reported.** `regimes.json` is committed beside the verdict. Every write-up carries the regime figures and says the intervals are not calibrated within a regime. This was a stated limit in decisions 33 and 34. |
| M3 | **Course intervals are often vacuous; speed bounds go negative.** 16.9% of fused course 90% intervals are vacuous (IMM 19.8%), and the median course 90% width is 188°. Without the vacuous rows, course-90 coverage is 88.6%, with rows that have no estimate left out of the denominator. 27.2% of speed 90% lower bounds are below 0. (statistics, geometry, red team) | **Agreed, and reported** in `regimes.json` and the write-ups. The course width ratio of 0.944 compares two mostly uninformative intervals and is not evidence of sharpness. |

### Minor findings and responses

- **The shift between seeds is sampling** (estimation, statistics): 48.32 → 48.62, a difference
  of 0.30 pp with SE ≈ 0.30 (z ≈ 1). The IMM moved the same way. No change is needed.
- **This was the second look** (statistics). At a true coverage of exactly 48%, each look passes
  with probability at most about 2.5%, so the false-pass risk over both looks is at most about 5%.
  C.5 allows this. The write-up discloses it and gives the pooled estimate.
- **The margin is smaller than the multipliers' error** (statistics). The 0.33 pp margin over the
  floor is below the multipliers' own sampling error of about 0.5 pp. The pass judges this frozen
  calibration, not the fitting procedure. The write-up says so.
- **The re-score's size decided the outcome** (estimation, red team). A smaller re-score would
  plausibly have come out inconclusive again. The size (at least about 110,000) was recommended
  by the seed-215 panel and fixed in decision 34 with a forecast of P(pass) ≈ 50%. The write-up
  says so.
- **run.sh stated 10–12 GB** (statistics). Fixed in d81f2d5: the streamed gate peaked at about
  0.4 GB.
- **The digest-pinning run was not logged** (red team). Seed 216 was generated once before
  decision 34, at ada7b5a, into `data/p6vpin`, to pin the plan's content digest. The session
  transcript shows exactly four operations on that directory:
  1. generation by `scripts/train-plan.mjs data configs/phase4/v/plan.json data/p6vpin test`;
  2. `sha256sum` of `test.f32pack`;
  3. reading its header;
  4. `rm -rf data/p6vpin`.

  No tracker, network or gate was run on it. This is now recorded here.
- **The equivalence of the streamed `tma-g7` on seed 215** (red team) could not be re-run, because
  that data is no longer on disk. It rests on the session's re-run, in which all 15 checks were
  identical and only `decided_by` differed. Two reviewers confirmed it from the code: `g7Rows`
  calls `g5Rows([s])` per scenario, and `clustersOf` renumbers. Geometry confirmed it on seed 216
  data field by field.
- **The quoted seed-215 regime figures are for settled rows** (geometry). Every quote now names its
  row set. Over all G5 rows on seed 216 the split is 66.5% before any manoeuvre and 41.9% after
  one.
- **The convention for coverage without vacuous rows** (geometry): rows with no estimate are left
  out of its denominator. This is stated wherever the figure is quoted.
- **`packages/eval/dist/cli-g7.js` was stale against the source before the review**
  (reproducibility). `tsc -b --force` changed only that file. It was most likely built before the
  last lint and format edits to `cli-g7.ts` were committed in 6bdf735. Those edits removed an
  unused import, an unnecessary assertion and a `String()` call, and changed nothing about
  behaviour. The repeat used dist rebuilt from the committed source and gave identical checks, so
  the verdict does not depend on that edit. From now on, a gate run is preceded by `pnpm build` on
  a clean tree.
- **`decided_by`** (red team): now set to round 2.

## Round 2

Estimation, statistics and red team (the reviewers with major findings) re-read the responses and
the write-ups at c9c7a90:

| Reviewer | Verdict | Open |
| --- | --- | --- |
| Estimation and numerics | approve-with-findings | 2 minor |
| Evaluation statistics | approve | 2 minor |
| Red team | approve-with-findings | 3 minor |

M1–M3 are closed. No reviewer rejects, and no blocker or major finding is open. Geometry and
reproducibility had no majors in round 1.

The minors were fixed as follows:
- **The row set is named.** The 67% and 39% figures are now labelled as settled rows in AGENTS.md
  and the fused-tracker note.
- **"Calibrated" is reworded** to "cover within tolerance" in the blog's title, its bullet and its
  closing line, and in the fused-tracker note.
- **The second look and the frozen-multiplier caveat** are now stated in AGENTS.md, the
  fused-tracker note and SRD §C.13.
- **Validation reuse** is described as "weakened", not ruled out, as an explanation (statistics). T2's
  epoch and the fusion's k and M were also chosen on that data. Only the multipliers' share is
  ruled out by the IMM's nominal coverage.
- **`decided_by`** is set.
