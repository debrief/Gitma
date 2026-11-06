# Phase 6 decision: calibrated uncertainty at G7 (decision 33)

This record is committed before seed 215's test data are generated for scoring. Seed 215's split
was generated once, to pin its content digest in `configs/phase4/u/plan.json`, and then deleted
unscored.

Requirements: SRD Annex C §C.13 and spec 018. Owner decisions 2026-11-06: calibrate the fused
tracker; judge it as calibrated and sharper.

## What is judged

**`fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd-k4-m6`**, against the reference
**`imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd`**.

- **The fused tracker.** Decision 32's reference IMM with the frozen T2's range fused in, k 4,
  every 6, as decision 31.
- **The stated sds.** Both write log-range, course and speed sds (`-sd`, spec 018). Their
  estimates are unchanged by `-sd`.
- **T2.** `experiments/20261101-p4b-models/models/tracker`, bound by `model_digests`, the same
  files as decisions 30 and 31.

## What is frozen

- **The multipliers**, fitted on every G5 row of seed-211 validation. The calibrated q-interval
  is ± m_q × stated sd.

| Tracker | Output | m50 | m90 |
| --- | --- | --- | --- |
| Fused | log-range | 0.4699 | 1.5216 |
| Fused | course | 0.2919 | 1.6471 |
| Fused | speed | 0.1722 | 0.6832 |
| IMM | log-range | 0.4095 | 1.4373 |
| IMM | course | 0.2981 | 1.6906 |
| IMM | speed | 0.1823 | 0.7194 |

  Exact values are in `decision.json`.
- **The gate.** G7 as §C.13, with 95% scenario-clustered intervals:
  - six coverage checks, each interval within nominal ± 2 pp;
  - three width checks, the median 90% width ratio wholly below 1.
- **The test.** Fresh seed 215: 400,000 scenarios, of which the 40,000-scenario test split is
  generated alone, at a clean commit descending from this one. The gate command is:

  ```
  tma-g7 --decision experiments/20261106-p6u-decision/decision.json --plan configs/phase4/u/plan.json --model experiments/20261101-p4b-models/models/tracker
  ```

- **Re-score.** One, on a larger fresh seed, if the result is inconclusive.

## Validation (`experiments/20261106-p6-research/`)

**Raw stated sds.** They are miscalibrated for both trackers. q50 is 0.17–0.47 and q90 is
0.68–1.69, against 0.674 and 1.645 for an honest Gaussian: typical intervals are far too wide,
with heavier tails.

**The two-fold check** (fitted on even-indexed scenarios, judged on odd ones):

| Check | Fused | Limit |
| --- | --- | --- |
| Coverage, log-range 50 / 90 | 49.9% / 90.4% | 48–52 / 88–92 |
| Coverage, course 50 / 90 | 50.8% / 89.8% | |
| Coverage, speed 50 / 90 | 48.5% / 90.2% | |
| Width, log-range | 0.747 [0.738, 0.755] | < 1 |
| Width, course | 0.940 [0.926, 0.954] | < 1 |
| Width, speed | 0.899 [0.882, 0.913] | < 1 |

## Forecast, recorded before scoring

- **P(G7 pass on seed 215) about 80%.**
  - Widths are safe: every upper bound is at or below 0.955.
  - The risk is coverage transfer from seed 211 to seed 215. On the half splits, coverage shifted
    by up to 1.5 pp.
- **Weakest check: speed-50.** On the odd half it was 48.5%, against a floor of 48%. The test's
  interval will be about ±0.5 pp.
- **A fail would most likely be** speed-50 or course-50 undercovering, meaning the 50% multipliers
  do not transfer. It would be reported as such, and G5's results stand.

## Known limits, stated in advance

- **The multipliers are global.** One pair per output, with no regime: whether a manoeuvre is
  under way is not known at run time. Coverage by regime is reported, not gated.
- **Delta-method sds.** They assume local linearity, which is poor at short range or low speed;
  the post-hoc multipliers absorb that on average.
- **Non-converged rows** count as uncovered, with infinite width, for both trackers.
