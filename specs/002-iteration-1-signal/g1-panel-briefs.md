# G1 agent review panel: reviewer briefs

Constitution 1.2.0 (Governance) and SRD §8 (decision of 2026-10-11): the G1 verdict is taken by an
agent review panel of at least five independent reviewers with distinct specialities. This file is
the brief each reviewer receives. It follows the pattern of the G0 panel
(`experiments/20261011-g0-r3/review.md`): read-only reviewers, severity-tagged findings, responses
committed with evidence, re-invitation until no reviewer rejects and no blocker or major finding
stays open.

## How the panel runs

1. **Evidence.** The G1 experiment folder `experiments/<date>-g1/` produced by the training workflow
   (`.github/workflows/train.yml` on `train/**` branches, pushed as `results/g1-<run id>`), and the
   re-scored folder with `bootstrap.json` produced by `.github/workflows/evaluate-g1.yml` on
   `eval/**` branches (pushed as `results/g1-eval-<run id>`, folder name suffixed `-r2`). The panel
   judges the re-scored folder, because only it carries the bootstrap intervals; the original run is
   evidence for reproducibility.
2. **Round 1.** Each reviewer works independently, read-only (no commits, no pushes), and may re-run
   any CLI locally. Reviewers do not see each other's reports in the round.
3. **Response.** Every blocker and major finding is fixed (new commit, new experiment folder if
   numbers change) or answered with evidence. Minor findings get a response or "accepted".
4. **Re-invitation.** Reviewers with open blockers or majors, or who rejected, are re-invited with the
   response table and the new evidence. Repeat until no reviewer rejects and no blocker or major is
   open.
5. **Record.** `experiments/<id>/review.md` in the G0 format (verdict tables per round; findings and
   responses tables with commits), and `verdict.json`'s `decided_by` names the panel round.

### Decision rules the panel applies

These are fixed before the results are seen; a reviewer who thinks one is wrong raises it as a
finding rather than reinterpreting it.

- **G1 criterion (SRD §5):** for both `lstm-instantaneous` and `bilstm-time-late`, median relative
  range error at `zig+300s`, overall, below 0.5 × naive's on the same scenarios.
- **Interval rule (T033):** with `bootstrap.json`, a G1 check passes only if the whole paired 95%
  interval of model/naive is below 0.5, fails if wholly at or above it, and is otherwise
  `inconclusive`.
- **Other checks** (`time-late-not-worse`, `*-beats-control`, `shuffled-labels-at-naive`) are part
  of the machine verdict, which is `fail` if any check fails. The panel must say explicitly, for
  each failed non-G1 check, whether it (a) invalidates the G1 evidence (pipeline suspect, leakage)
  or (b) qualifies the claim (e.g. "signal exists, but no evidence of sequential learning") without
  changing the SRD §5 outcome. See "Open questions for the panel" below.

### Severity

| Severity | Meaning |
| --- | --- |
| blocker | The verdict cannot be trusted or is wrong as recorded (e.g. leakage, wrong sample, gate miscomputed). Must be fixed before any decision. |
| major | The verdict may be right but the evidence does not yet show it, or a reported number is misleading. Must be fixed or answered with evidence. |
| minor | Clarity, documentation, or a limitation that does not change the decision. Response or "accepted". |
| note | Observation for later iterations (G2/G3). No response required. |

### Required output format (every reviewer)

```
VERDICT: approve | approve-with-findings | reject

FINDINGS
| # | Severity | Finding | Evidence (file:line, command + output, or number) | Suggested fix |
| --- | --- | --- | --- | --- |
| 1 | blocker/major/minor/note | … | … | … |

WHAT I CHECKED
- one line per check, with the command run or file read, and what it showed
  (including checks that found nothing wrong)

WHAT I DID NOT CHECK
- anything in the brief left unverified, and why
```

- `approve`: no findings above minor. `approve-with-findings`: minor or note findings only, or
  majors the reviewer judges answerable without new evidence (state which). `reject`: any blocker,
  or a major that must be fixed before the verdict can stand.
- Every finding cites evidence a second reader can verify. "Looks wrong" is not a finding.
- **Word limit: 900 words** per report, excluding tables of numbers copied from the evidence and
  command output. Re-invitation reports: 400 words, covering only the findings re-reviewed and any
  new ones.

### Evidence common to every reviewer

| Evidence | Where |
| --- | --- |
| Requirements | `docs/SRD.md` §4 (models, controls), §5 (baselines, metrics, G1), §7 (iteration 1), §8 (risks) |
| Principles | `.specify/memory/constitution.md` (IV Honest measurement, V Gates, Governance) |
| Spec and design | `specs/002-iteration-1-signal/` spec.md, plan.md, research.md (R1–R9), tasks.md (T030–T040), contracts/cli.md, g1-limits.md |
| Verdict and checks | `experiments/<id>/verdict.json` |
| Intervals | `experiments/<id>/bootstrap.json` (re-scored folder only) |
| Metrics | `experiments/<id>/metrics.json`, `metrics.csv` (overall and slices; `<estimator>:per_timestep`) |
| Curves | `experiments/<id>/curves.csv` (per estimator, per `t_since_zig_s`, with `n`) |
| Held-out geometry | `experiments/<id>/heldout/` (20–30 km initial range; reported, not gated, FR-014) |
| Models | `experiments/<id>/models/<id>/{manifest.json,model.json,weights.bin}` |
| Training logs | `experiments/<id>/logs/<model>.log` (per-epoch loss, `lscpu` model name) |
| Run manifest | `experiments/<id>/manifest.json` (git commit, dirty flag, Node version, dataset digests, command line) |
| Gate code | `packages/eval/src/gate-g1.ts`, `bootstrap.ts`, `evaluate.ts`, `errors.ts`, `slices.ts`; `packages/models/src/g1.ts`, `predict.ts`, `batches.ts`, `train.ts`, `architectures.ts` |
| Baselines | `packages/classical/src/naive.ts`, `estimate.ts` (per-timestep, `PLAUSIBLE`), `lsq.ts` |
| Workflows | `git show origin/train/i1:.github/workflows/train.yml`, `git show origin/train/i1:.github/train-plan.json`, `.github/workflows/evaluate-g1.yml` |
| G0 record | `experiments/20261011-g0-r3/review.md` (findings carried into G1: M4 matched samples, M5 +∞ scoring, M6 small-n curve points, M7 shuffled-label and counterfactual tests) |

Model ids: `lstm-instantaneous`, `bilstm-time-late`, `cnn-causal-control`, `mlp-control`,
`lstm-instantaneous-shuffled`. Baselines: `naive`, `classical` (all `:per_timestep`).

---

## Brief 1 — TMA geometry

**Role.** You know bearings-only target motion analysis: observability needs an ownship manoeuvre,
range is unobservable on a single leg, and solution quality depends on range, bearing rate and zig
geometry. Judge whether the models' behaviour is what the geometry predicts, or a sign that they
learned something else.

**Read.** `curves.csv` (all estimators), `metrics.json` slices `range_band=*` and `zig_band=*`,
`heldout/metrics.json` and `heldout/curves.csv`, `site/docs/algorithms/generator.md`,
`site/docs/algorithms/models.md`, `configs/iter1-ranges.json`, `configs/iter1-heldout-ranges.json`,
`packages/eval/src/slices.ts`.

**Questions.**

1. **Curve shape after the zig.** Does each model's median range error fall after the zig the way the
   classical per-timestep curve does (large near the zig, converging over minutes)? A model curve
   that is flat from `t = 10 s` is predicting a prior, not solving. A model that is *better* than
   classical in the first 60 s after the zig needs explanation (the problem is barely observable
   there).
2. **Instantaneous vs time-late.** Time-late sees the whole window, including the post-zig leg, at
   every row: is its curve flatter and lower than instantaneous at every point, as expected? Where
   does `time-late-not-worse` fail, if anywhere, and is that geometry or training?
3. **Range bands.** Errors are relative, so a geometric solver should be roughly range-independent at
   fixed bearing noise, degrading at long range (lower bearing rate). Do the models instead do best
   near the middle of the log-uniform range prior (≈ 6 km), the signature of learning the prior?
   Check `range_band=2-5km`, `5-10km`, `10-20km`; treat bands with n < 200 as anecdotal (G0 rule).
4. **Zig-angle bands.** Larger zigs (`70-90deg`) should help a geometric estimator. Is the model
   ordering across `30-50`, `50-70`, `70-90deg` the same as classical's?
5. **Held-out geometry (20–30 km).** Outside the training range: does error grow smoothly (geometry
   generalises) or does the model clamp to ≈ 20 km (prior learned)? Compare with classical on the
   same split. Not gated; report what it suggests.
6. **Course and speed.** At `zig+300s`, are course and speed errors consistent with the range error
   (a good range with a 90° course error suggests the network is exploiting something other than the
   bearing geometry)?
7. **Gate point.** Is `zig+300s` a sensible gate point for both variants at σ = 0.5°, given the
   classical curve?

---

## Brief 2 — Estimation and numerics

**Role.** You check the estimators and the numbers they produce: baselines, prediction conversion,
loss, non-finite handling and the classical per-timestep solver.

**Read.** `packages/classical/src/estimate.ts` (`PLAUSIBLE`, per-timestep warm start and grid
restart), `lsq.ts`, `naive.ts`, `packages/eval/src/errors.ts`, `evaluate.ts`, `stats.ts`,
`packages/models/src/predict.ts`, `loss.ts`, `batches.ts`, `metrics.json` (`non_converged_rate`,
gross-error rate) for every estimator, model manifests (`epochs`, `stop_reason`, `best_epoch`).

**Questions.**

1. **Classical non-converged rows.** Per-timestep classical rows that did not converge, or converged
   outside `PLAUSIBLE` (speed > 25 m/s or range > 100 km), are scored as +∞ on every metric. What is
   classical's `non_converged_rate` at `zig+300s` and along the curve? If it is high near the zig,
   is classical's median there meaningful, and is the "classical beside every model number" honest?
   Are the plausibility limits so loose they admit absurd solutions, or so tight they reject
   legitimate long-range ones (held-out split reaches 30 km initial range)?
2. **Grid restart.** Per-timestep estimates restart from the grid when the warm start fails or is
   implausible (AGENTS.md gotcha). Is there evidence of runaway ranges or mode-hopping in the
   classical curve (sudden P90 spikes between adjacent curve points)?
3. **Model non-finite outputs.** Do any model rows have `converged = false` (NaN/∞ from the network)?
   They must be counted, not dropped (spec edge cases).
4. **Prediction conversion (R7).** Range `= 1000·exp(log_range_km)`, course `= atan2(sin, cos)`,
   speed unscaled with the manifest's constant, position from range and the last valid bearing.
   Spot-check a few rows of a prediction file against the model outputs (re-run
   `pnpm tma-model-predict` on a handful of scenarios). Near-zero course vectors: flagged?
5. **Naive baseline.** Per-timestep naive is a single constant (training-set mean of every post-zig
   label). Confirm the constant matches the run manifest and that naive's median at `zig+300s` is
   plausible for a log-uniform 2–20 km prior.
6. **Loss and masking (R5).** Causal models train only on post-zig rows; non-causal on all window
   rows. Does that asymmetry bias the comparison at `zig+300s` (time-late spends capacity on pre-zig
   rows it is never scored on)?
7. **Training convergence.** From each manifest's epoch curve: did any model stop on the wall-clock
   cap rather than early stopping (undertrained)? Any divergence? Does the best validation loss
   ordering match the test ordering?

---

## Brief 3 — Evaluation statistics

**Role.** You judge whether the numbers support the verdict: samples, intervals, small n and
training noise.

**Read.** `verdict.json` (every check's `detail`), `bootstrap.json`, `metrics.json`, `curves.csv`,
`packages/eval/src/bootstrap.ts`, `gate-g1.ts`, model manifests (`epochs`, `best_epoch`,
`stop_reason`, `config.patience`), training logs.

**Questions.**

1. **Matched samples.** Every G1 check compares estimators on the same scenarios (equal `n` and
   `excluded` at the point; G0 M4). Confirm in each check's detail. Is equal `n`/`excluded` actually
   sufficient to prove the *same* scenarios (it is a count check)? `pairedRangeErrors` pairs by
   scenario index; does its `n` in `bootstrap.json` equal the metrics' `n`?
2. **Bootstrap interpretation.** The interval is a paired percentile bootstrap of
   median(model)/median(naive), 2,000 resamples, nearest-rank percentiles, fixed seed. It covers
   test-set sampling only: not training-seed variance, not CPU-dependent training trajectories. Is
   that the right uncertainty for a go/no-go claim? Is 2,000 resamples enough for stable 2.5/97.5
   percentiles? Are +∞ errors handled correctly in a resample (median of a sample with ∞)?
3. **Inconclusive.** If either G1 check is `inconclusive`, what does the evidence support? (There is
   no pre-registered follow-up; see "Open questions".)
4. **Small curve-point n.** `time-late-not-worse` gates only curve points with n ≥ 500 (G0 M6). How
   many points were gated and how many skipped? Is a 5% slack on a median at n ≈ 500–1,000
   meaningful, or would an interval-based consistency check change the outcome?
5. **Controls and leakage without intervals.** `*-beats-control` compares point medians (`m < c`) and
   `shuffled-labels-at-naive` uses a ±10% band, both without intervals. Where the margins are small,
   say whether the result would survive test-sampling noise (estimate it, e.g. by re-running the
   bootstrap for that pair).
6. **MLP early stopping.** All models use patience 3 on validation loss. The MLP's validation loss is
   noisy; the same MLP config stopped at best epoch 20 on one runner CPU (AMD EPYC 7763) and 27 on
   another (EPYC 9V74). Is the control check sensitive to where early stopping happened to land? A
   control that lost because it stopped early is not evidence of sequential learning.
7. **Slices.** Are slice tables reported with n beside them; are there conclusions drawn from slices
   with n < 200?
8. **Medians and P90s.** Constitution IV: medians and 90th percentiles, gross-error rate alongside, no
   means. Check the reported tables (and the blog draft) comply.

---

## Brief 4 — Reproducibility

**Role.** You confirm the verdict can be re-created from what is committed and that every artefact
is the one the verdict claims.

**Read.** Run manifest and every model manifest (`git_commit`, `git_dirty`, `node_version`,
`cpu_model`, dataset digests, `weights_digest`, config), `logs/`, `seeds.txt`,
`git show origin/train/i1:.github/workflows/train.yml` and `train-plan.json`,
`.github/workflows/evaluate-g1.yml`, research R2 (determinism caveat).

**Questions and required re-runs.**

1. **Re-score locally.** Regenerate the data (seed 101, `configs/iter1-ranges.json`,
   `configs/iter1-heldout-ranges.json`; quickstart §1) and run
   `pnpm tma-g1 --data <dir> --models experiments/<id>/models --experiment /tmp/<x>` on the committed
   weights. Compare `metrics.json`, `curves.csv`, `verdict.json` and `bootstrap.json` with the
   committed re-scored folder. Expected: identical, or differences in the last float32 digit only
   (inference kernels may differ by CPU); report any difference beyond that and which metric.
2. **Original vs re-scored.** Compare the training run's folder with the `-r2` re-scored folder for
   the shared files. They were produced by different code (re-score adds bootstrap and the
   `inconclusive` result); everything except `bootstrap.json` and the verdict detail should match.
3. **Mixed provenance.** Models may come from two workflow runs: `train-plan.json` reused run
   38131616871 for four models and retrained only `time-late`. Check each model manifest's
   `git_commit`: is the training code identical across models (`git diff <a> <b> -- packages/`)? The
   training branch `train/i1` diverges from `main` (predictive wall-clock stop in `train.ts`,
   `max_wall_s` 19,800 in the configs, schema 0.4.0 vs main's 0.5.0). Is every difference recorded,
   and does any affect the numbers?
4. **Data identity.** Each training job regenerated the data. Do the dataset digests in all five
   model manifests agree with each other? The re-score regenerates at schema 0.5.0, so file digests
   will differ from training-time ones by the header: confirm that only the header differs (e.g.
   compare scenario records), not the scenarios.
5. **Weights are CPU-dependent.** Weights are byte-reproducible only on the same CPU family (R2). The
   same MLP config stopped at best epoch 20 on EPYC 7763 and 27 on EPYC 9V74. Record each model's
   `cpu_model`. Re-training is not required, but say what a re-run on a different runner would and
   would not reproduce, and whether the verdict depends on it (see statistics Q6).
6. **Weights digest.** `weights_digest` in each manifest matches `sha256` of the committed
   `weights.bin`; `model.json` and `manifest.json` agree on architecture.
7. **Dirty tree / rebuilt dist.** `git_dirty: false` in every manifest; `tma-g1` refuses a dirty tree.
8. **FR-009.** Every configuration tried (≤ 4 per model) is listed, not only the one used.

---

## Brief 5 — Red team

**Role.** Assume the result is wrong and try to show how. Look for leakage, unfair controls,
mis-specified checks and anything that would let a model pass G1 without extracting geometry.

**Read.** Everything above, especially `packages/models/src/batches.ts` (label shuffling),
`architectures.ts`, `predict.ts`, `packages/features/src/`, the normalisation and counterfactual input tests (`packages/features/test/leakage.test.ts`), causality
tests (`packages/models/test/causality.test.ts`), `packages/data/src/` (splits), g1-limits.md.

**Questions.**

1. **Leakage into inputs.** Can any input channel carry target truth (time scaling, window length,
   padding position, ownship manoeuvre timing correlated with the target)? The counterfactual test
   shows inputs are byte-identical when target truth changes; check it covers every channel and the
   features actually used. Normalisation constants: inputs only (`norm.json`)?
2. **Shuffled-label model.** Labels are permuted across scenarios with a fixed seed; inputs are
   unchanged; row weights combine both windows' masks and the label window's post-zig mask. The best
   it can learn is roughly E[label | row index, window shape]. Did it converge to that (training
   curve flat at the label variance) or did it stop early at 2 h before learning even the mean? A
   model that never trained would also sit near naive and pass the check vacuously. Compare its
   predictions' spread with naive's constant.
3. **Fair controls.** The causal CNN's receptive field is 43 rows (≈ 7 min): at `zig+300s` it can see
   the zig and ≈ 2 min before it, but at `final` it cannot see the zig at all if the post-zig leg is
   longer than 7 min. Is beating it at `final` evidence of sequence learning, or of the control
   being blinded by design? The MLP sees the whole flattened window (0.93M parameters, the most of
   any model) but has no translation invariance: is it a fair non-recurrent control for time-late?
4. **Time-late uses the future.** Time-late's output at `zig+300s` uses bearings after that time. That
   is legitimate by SRD §4 (post-hoc reconstruction), but confirm (a) it is reported as such, never
   as a real-time result, (b) the G1 claim for time-late is not read as evidence for real-time TMA.
5. **Causality.** Perturbation tests show instantaneous and CNN outputs at t ignore inputs after t.
   Is masking (padding rows) also unable to leak window length into early rows for the causal LSTM?
6. **Train/test overlap.** Splits are contiguous index ranges of one seed (101), each scenario keyed by (seed, index) (`packages/data/src/generate.ts`); check no scenario (or
   near-duplicate geometry) is in both train and test, and that the held-out split is disjoint.
   Seed reuse with G0 (42) is ruled out by process rule; confirm.
7. **Gate mechanics.** Could the verdict pass with a check silently skipped (missing curve points,
   absent medians treated as +∞ in the right direction, `inconclusive` mapped to pass)? Try a
   synthetic metrics file through `tma-gate g1`.
8. **Selection.** Was any run, seed or configuration discarded after seeing test results? Was the
   test split touched before the verdict (e.g. in earlier debugging runs)?

---

## Open questions for the panel

The process does not yet answer these; the panel should record its position on each in the review
record rather than decide them case by case after seeing the numbers.

1. **Inconclusive G1.** If either G1 interval straddles 0.5: stop (as a fail), re-score on a larger
   fresh test set (new seed, recorded), or re-train with more seeds? The constitution and SRD define
   pass and fail only.
2. **Non-G1 check failures.** The machine verdict fails if a control or consistency check fails,
   but SRD §5's G1 criterion is the ratio alone; constitution IV says a recurrent model must beat its
   control "to claim sequential learning", and SRD §4 says a time-late failure makes the pipeline
   "suspect". Agreed reading proposed for the panel: leakage failure → G1 evidence invalid;
   time-late-not-worse failure → pipeline suspect, investigate before deciding; control failure → G1
   may still pass on the ratio, but the claim is "signal exists" without "sequential learning".
3. **Borderline numbers.** SRD §7 still says "Doc has the casting vote where the numbers are
   borderline"; §8 and the constitution replace the team review with the panel. Flag for an SRD
   wording fix.
