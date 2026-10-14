# Evaluation and gates

Source: `packages/eval`. Requirements: SRD §5, spec 001 FR-015–FR-019, spec 003 FR-013–FR-018.

## Errors per estimate

| Metric | Definition |
| --- | --- |
| Range error | `|r̂ − r| / r` (relative) |
| Course error | `|wrap(θ̂ − θ)|` in degrees, wrapped so 359° vs 1° is 2° |
| Speed error | `|v̂ − v|` in knots |
| Position error | `|p̂ − p|` in metres |
| Gross error | range error > 50%, **or** the estimator did not converge |

## Aggregation

Median and 90th percentile (nearest-rank: the value at rank `⌈p·n⌉` of the sorted list), plus
gross-error rate and mean position error. Means are not used for the headline numbers because TMA
failures are heavy-tailed.

### Window-mean position error

SRD §5 defines time-late position error as the mean |p̂ − p| over the window. Per scenario,
`tma-eval` averages the position error over the rows the estimator predicted (models emit post-zig
rows only, so this is the post-zig window). Rows without an estimate (non-converged) are left out
of that scenario's mean; a scenario with no estimate at all counts as +∞. Across scenarios the
report gives the **median and P90** of these per-scenario means (`position_window_m_median`,
`position_window_m_p90`, on the `final` rows), for every estimator so the time-late models sit
beside naive and classical. It is reported, not gated.

## Slices

`overall`; range band by mean range over the window (0–2, 2–5, 5–10, 10–20, 20–30, 30+ km); zig band
by |zig angle| (30–50, 50–70, 70–90°); noise σ (`sigma=1deg`, `sigma=2deg`, …); dropout band by the
drawn dropout fraction (`dropout_band=0-5pct`, `dropout_band=5-10pct`; exactly 5% goes in the upper
band). Every record carries `n`; no conclusion is drawn from a slice with n < 200.

## Points and curves

- `final`: the estimate at the last sample.
- `zig+300s`: per-timestep estimates five minutes after the zig, the gate point for the
  instantaneous variant. Scenarios whose window ends earlier are excluded and counted.
- `zig+600s`: ten minutes after the zig, G2's speed point (`tma-eval --points 300,600`).
- Curves: per-timestep medians every 60 s after the zig (`curves.csv`).

## Bootstrap intervals on a single median

A median from a few thousand heavy-tailed errors still moves from one test set to the next, so a
gate threshold is judged on an interval, not on the point estimate alone. `tma-eval --bootstrap
<B> [--bootstrap-seed <u64>]` writes `bootstrap.json`:

- **Single medians** (G2): for every per-timestep estimator, at each point, on the overall and σ
  slices, the median range, course and speed error with a 95% percentile bootstrap interval.
  Scenarios are resampled with replacement B times (2,000 for gate runs); the interval is the
  2.5th–97.5th nearest-rank percentiles of the resampled medians.
- **Paired ratios** (G1, repeated in G2): each estimator's median range error over naive's, with
  the same resample applied to both, so the interval describes the comparison on one test set.

Every interval restarts the seeded PRNG (SplitMix64; never `Math.random`), so the same inputs and
seed give byte-identical intervals. A non-converged row counts as +∞; a bound that is infinite is
left out of the JSON and read back as +∞, which can only make a check fail or stay inconclusive.

## Comparison with classical on common rows

Scoring a missing estimate as +∞ is right for one estimator's medians, but once the classical
solver fails to converge on more than 10% of a slice its P90 becomes infinite and says nothing
about the solutions it did produce. `tma-eval --compare-to classical:per_timestep` writes
`comparison.{csv,json}`: for each other estimator, slice and point, the metrics of both on the
rows **both** answered (converged, every error finite), `n_common`, and each estimator's coverage
(answered / scored) reported separately. It is reported, not gated (G3 will use it).

`tma-eval` refuses to write a report unless naive and classical predictions for the same test file
are among its inputs, and rejects predictions made from a different truth file (SHA-256 check).

## G0 — pipeline verified

On a noise-free test split (`tma-g0`):

1. **Final-mode recovery**: the classical estimate is within 0.1% range, 0.1° course and 0.01 kt
   speed of truth on **every** scenario, and converged.
2. **Per-timestep recovery** (the G1 baseline path): on 1,000 scenarios every row converges, and
   every row at least 60 s after the zig is within the same tolerances.
3. **Bearing residuals**: every final solution's RMS bearing residual is ≤ 10⁻⁶ rad (float32
   precision), so any mismatch between observations and the constant-velocity fit shows up.
4. **Independent geometry**: hand-computed bearings (before and after the zig, with literal
   `Math.atan2`, not the shared code) and, on every scenario, the t = 0 bearing and range against
   the drawn parameters. This catches frame errors that generator and solver would share.
5. **Naive determinism**: two in-process fits give identical metrics.

## Running and deciding gates

Run gates through `pnpm tma-g0` / `pnpm tma-g1`: they rebuild first and refuse a dirty working tree,
and the manifest records the commit, Node version and SHA-256 of every dataset. The commit and the
dirty flag are both read when the process starts, so they describe the code that ran, not the tree
at write time.

Committed models are re-scored on GitHub Actions by `evaluate-g1.yml`. The source experiment
folder is named explicitly: the `source` input of a manual run, or `.github/eval-source` (one line,
e.g. `experiments/20261011-g1`) on the pushed `eval/**` branch. With neither, the run uses the only
`experiments/*-g1*/models` folder and fails if there is more than one.

### Agent review panel

Gate verdicts are decided by five independent specialist AI reviewers (TMA geometry, estimation and
numerics, evaluation statistics, reproducibility, red team), not by humans. Findings are fixed or
answered, and the panel is re-invited until none rejects and no blocker or major finding is open.
G0 took three rounds; the record is
[`experiments/20261011-g0-r3/review.md`](https://github.com/debrief/Gitma/blob/main/experiments/20261011-g0-r3/review.md).

## G1 — checks and how they combine

G1 scores each model against naive 5 minutes after the zig, using a paired bootstrap 95% interval
of the ratio of median range errors. A ratio check passes when the whole interval is below 0.5,
fails when it is wholly at or above 0.5, and is otherwise inconclusive. If naive's median at that
point is missing or not finite there is no limit to beat, and the check fails. The other checks combine
by a tiered rule:

| Check | If it fails |
| --- | --- |
| Ratio, both variants | G1 fails (an inconclusive interval makes G1 inconclusive) |
| Shuffled labels at naive | The evidence is invalid (possible leakage): G1 fails |
| Time-late not worse than instantaneous | The pipeline is suspect: G1 is at best inconclusive until investigated |
| Each recurrent model beats its control | Reported only: G1 can pass, but without a "sequential learning" claim |

If G1 is inconclusive, the panel may order one re-score on a larger test set drawn from a new
seed. If that is still inconclusive, G1 fails.

## G2 — useful

`tma-gate g2` judges each gated variant (instantaneous and time-late, both must pass) on the
**σ = 1° slice** against SRD §5:

| Check | Statistic | Threshold | Point |
| --- | --- | --- | --- |
| `g2-<variant>-range` | median range error | < 20% | zig + 300 s |
| `g2-<variant>-course` | median course error | < 10° | zig + 300 s |
| `g2-<variant>-speed` | median speed error | < 1 kt | zig + 600 s |

Speed is judged at ten minutes because at σ = 1° the classical solver's own median speed error is
1.28 kt five minutes after the zig and 0.61 kt at ten (SRD §5 amendment of 2026-10-11, spec 003
research R12); a five-minute speed threshold would ask the model to beat the classical reference.

Each check records the median (`value`), the `threshold`, and its 95% interval (`ci_low`,
`ci_high`, `ci_level`), and its detail gives naive's and classical's medians on the same rows:

- **pass**: the whole interval and the median are below the threshold;
- **fail**: the interval lies wholly at or above the threshold;
- **inconclusive**: anything else, i.e. the interval contains the threshold, on whichever side
  the median falls (FR-015; corrected after the G2 panel, which found the median alone could fail
  a straddling interval).

A check also fails if the model was not scored on the same rows as naive and classical (`n` and
`excluded` must match), or if its interval was not computed from those rows.

### Test-split integrity

`tma-g2 --split test` refuses to score unless three things hold. The G2 panel asked for these, and
they arrived with iteration 2b (spec 004):

- **The data are the plan's.** `--plan` checks the scenarios' content digests against the plan's
  and records the result in the manifest.
- **The decision came first.** The commit that added the phase decision is an ancestor of every
  carried model's training commit.
- **Same rows.** Every estimator predicts exactly the same rows (scenario and timestamp) as naive.

Each test split decides at most one gate. A later round is judged on a **fresh test split**: the
test split of a new seed, with the same count and ranges, pinned by digest in the plan as
`dataset.fresh_test`.

### Inconclusive

`inconclusive` is a result in its own right, not a soft pass: the gate cannot pass while any
deciding check is inconclusive, and `tma-gate` exits 3 for anything other than pass (`verdict.json`
tells fail and inconclusive apart). If G2 is inconclusive, the panel may order one larger test set
from a fresh seed; still inconclusive then counts as a fail.

### Iteration-1 checks, repeated on noisy data

G2 repeats every G1 check on the noisy test set: each variant < 0.5 × naive (paired interval),
time-late not worse than instantaneous, each recurrent model beats its control, shuffled labels at
naive. They keep their G1 roles:

| Check | If it fails |
| --- | --- |
| A G2 threshold check, either variant | G2 fails (inconclusive makes G2 inconclusive) |
| Ratio to naive, either variant | G2 fails (inconclusive makes G2 inconclusive) |
| Shuffled labels at naive | The evidence is invalid (possible leakage): G2 fails |
| Time-late not worse than instantaneous | G2 is at best inconclusive until investigated |
| Each recurrent model beats its control | Reported only |

`--slice`, `--point` (range and course) and `--speed-point` exist for diagnostics on the validation
split; a committed G2 verdict always uses the defaults. The verdict is then decided by the agent
review panel, as for G0 and G1.
