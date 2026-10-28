# Iteration 5 G3 on seed 207: run log and review

Decision: `../20261027-i5-decision/` (decision 24, spec 009). Code at commit 4bca164 (main, the
merge of PR #57). The only change to `packages/` after the decision record is cc4365c, a test-only
fix to `packages/eval/test/cli-g3.test.ts`.

## Test data (recorded before scoring)

`node scripts/generate-splits.mjs --seed 207 --count 200000 --ranges configs/iter4-ranges.json
--heldout-ranges configs/iter4-heldout-ranges.json --out data/i5 --splits test`, from a clean tree
at 4bca164:

- `data/i5/test.f32pack`: seed 207, split test, indices [180000, 200000), 20,000 scenarios,
  generator 0.3.0, `generator_git_commit` 4bca164, `generator_git_dirty` false, 4,358 redraws.
- Content digest (`train-plan.mjs digest`):
  `bc72f976acf050ec45b65a744d9929bfd6e86e8faa7a22a27660bedd25b7ae5a`.

## Run (2026-10-28 06:12–06:50 UTC, commit 08ffbf5, clean tree)

- **Script:** `run.sh`. The log is in `run-log.txt` and the prediction file digests in
  `predictions.sha256`.
- **Aborted launch:** one launch at 06:11 was stopped during the feature build, before any
  prediction or score. The script passed `--points` twice, but `tma-eval` takes one
  comma-separated list. It was fixed to `--points 300,600` and relaunched at 06:12.
- **Steps:**
  1. Features: derived, with the LSTM's own normalisation.
  2. `tma-model-predict`: lstm-instantaneous.
  3. `tma-solve --per-timestep`.
  4. Naive: fitted on seed 205's train split.
  5. `tma-hybrid`: 62,773 of 1,433,304 rows switched (4.4%, all σ).
  6. `tma-eval`: 2,000 resamples, points 300 and 600 s, compared to classical.
  7. `tma-g3 --decision`: exit 0.

## Result: G3 **pass** (`tma-g3`), pending the panel

σ = 1° slice. There are 9,834 rows at zig + 300 s and 6,483 at zig + 600 s. The ratios are paired
bootstrap 95% intervals against 1.2.

| Check | Hybrid / classical, or difference | 95% CI | |
| --- | --- | --- | --- |
| range median, zig + 300 s | 1.003 | [1.000, 1.009] | pass |
| range P90, zig + 300 s | 0.989 | [0.976, 0.999] | pass |
| course median, zig + 300 s | 1.011 | [1.003, 1.018] | pass |
| course P90, zig + 300 s | 0.966 | [0.932, 0.983] | pass |
| speed median, zig + 600 s | 1.010 | [1.002, 1.016] | pass |
| speed P90, zig + 600 s | 1.015 | [1.001, 1.030] | pass |
| gross-error rate, zig + 300 s | 0.569% vs 1.190%: −0.620 pp | [−0.824, −0.417] pp | pass |

Each estimator, median / P90 (`metrics.json`):

| σ = 1° | Range | Course | Speed | Gross |
| --- | --- | --- | --- | --- |
| zig + 300 s, naive | 40.7% / 162% | 91.0° / 162° | 4.19 / 7.66 kt | 38.1% |
| zig + 300 s, classical | 3.35% / 14.8% | 1.37° / 18.1° | 0.530 / 3.71 kt | 1.19% |
| zig + 300 s, LSTM | 7.16% / 20.8% | 4.75° / 23.5° | 1.224 / 4.03 kt | 0.99% |
| zig + 300 s, **hybrid** | 3.36% / 14.6% | 1.38° / 17.5° | 0.535 / 3.57 kt | **0.57%** |
| zig + 600 s, naive | 41.4% / 142% | 90.4° / 162° | 4.22 / 7.68 kt | 38.2% |
| zig + 600 s, classical | 2.47% / 10.2% | 0.69° / 6.2° | 0.307 / 1.92 kt | 0.14% |
| zig + 600 s, LSTM | 6.84% / 17.8% | 3.49° / 14.4° | 0.956 / 2.99 kt | 0.26% |
| zig + 600 s, **hybrid** | 2.49% / 10.4% | 0.69° / 6.4° | 0.310 / 1.95 kt | 0.17% |

**Against the forecast.** The decision forecast ratios of 0.99–1.03 and gross errors falling
from about 1.2% to 0.5–0.6%. The result is ratios of 0.97–1.02 and 1.19% → 0.57%.

**Reported, not gated.**
- **Zig + 600 s.** The hybrid's gross rate is 0.17% against classical's 0.14%. At 6,483 rows
  that is 11 against 9. Here the switch takes the network's row a little more often than it
  helps.
- **Validation.** The gate result reproduces the validation diagnostic (R3): 1.25% → 0.55%.

## Panel round 1 (2026-10-28): all five approve with findings, none rejects

| Reviewer | Verdict | Independent check |
| --- | --- | --- |
| TMA geometry | approve-with-findings | Recomputed the gate rows and gross counts (classical 117, LSTM 97, hybrid 56 at zig + 300 s). Gains are in near-unobservable geometry: beyond 12 km, gross errors fall 95 → 23; below 0.5 °/min bearing rate, 41 → 9; under 60° ownship course change, 18 → 6. |
| Estimation and numerics | approve-with-findings | Recomputed `hybridSwitch` for all 20,000 scenarios: identical file. In switched rows the LSTM's range is better in 96 of 140. R2 holds on seed 207: the truth's cost was lower than classical's in 0 of 97 converged switched rows. |
| Evaluation statistics | approve-with-findings | Own geometry and resampler (4,000 draws). All seven checks match. Gross difference −0.620 pp [−0.834, −0.427], from 82 classical-only against 21 hybrid-only gross rows. 20,000 scenarios is adequate. |
| Reproducibility | approve-with-findings | Regenerated seed 207 (digest bc72f976…). Model digests match. `git diff 4bca164 8c5575b -- packages scripts configs` is empty. The re-run of `tma-hybrid`, `tma-eval` and `tma-g3` is byte-identical. 40 scenarios re-predicted by classical and the LSTM match exactly. |
| Red team | approve-with-findings | No truth in the switch, and the network is causal (unidirectional LSTM). Data, model and normalisation are right. The rule was fixed before seed 207 existed. Own recompute matches. |

No blocker or major findings. Responses to the minors:

- **The claim** (red team, statistics, numerics).
  - This is a **hybrid** result: classical's estimate, replaced by the network's in about 1.4%
    of σ = 1° rows at zig + 300 s and 0.45% at zig + 600 s.
  - It shows parity with classical plus a lower early gross-error rate. It does not show that a
    network alone matches classical: the LSTM alone is 0.956 kt against classical's 0.307 kt at
    zig + 600 s.
  - **Accuracy.** The hybrid is not better than classical, and it is measurably about 1% worse
    on the course and speed medians: both intervals exclude 1. That is immaterial against 1.2.
- **Where the switch hurts** (numerics, geometry).
  - At zig + 300 s, 140 σ = 1° rows switch. 82 classical gross errors are fixed, 21 good
    classical rows become gross, 1 is gross either way and 36 are neither. In 44 of the 140 the
    range gets worse.
  - The cost is at short range and high bearing rate. Under 4 km, gross errors rise from 2 to 20.
    There classical is sharp and the network's relative range error is large, and the 50% test
    is measured against the network's range.
  - A range or bearing-rate condition on the switch would be a new, pre-registered change. It
    is not made here.
- **Zig + 600 s, reported and not gated** (statistics, red team, geometry).
  - Hybrid 0.170% against classical 0.139% (11 against 9 rows): +0.031 pp [−0.062, +0.123].
  - There is no evidence of a difference either way. The SRD's "lower gross-error rate" is shown
    only at the pre-registered point, zig + 300 s.
  - At zig + 600 s, 29 rows switch: 4 fixed and 6 broken, all under 2.8 km.
- **The shared 50% constant** (red team). The switch threshold equals the gross-error bound, so
  the rule aims at the metric G3 gates on. That is by design, fixed in the decision before seed
  207 was generated, and stated here.
- **σ = 2°** (red team; reported, not gated).
  - At zig + 300 s: range 6.45% against 6.58%, speed 0.993 against 1.017 kt, gross 1.80%
    against 4.63%.
  - At zig + 600 s: gross 0.62% against 1.36%, with every median within 1%.
  - The hybrid's benefit grows with noise.
- **Zig angle** (geometry). Under `across_los`, the zig-angle slice is ownship's course change,
  up to about 180°, not the 30–90° target offset. Slices are labelled so in the write-up.
- **Records** (reproducibility, red team).
  - The aborted 06:11 launch's step log is `run-log-aborted-launch.txt`. It reached the LSTM
    step, but no prediction was written; the relaunch rebuilt everything.
  - `predictions.sha256` now also holds `test.features.bin`, `test.f32pack` and `norm.lstm.json`.
  - `tma-g3` binds the decision and the seed, but not the data or model digests. They were
    checked by hand here, and binding them in the tool is a follow-up.
- **Cost precision** (numerics). The panel's cost comparisons use the float32-rounded reported
  state. That is noted, and it is enough for the comparison.

**Decision: G3 PASS for the hybrid** (SRD §5, decision 24). It is decided by the agent review
panel, round 1: no rejections, no open blocker or major findings.
