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
