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
  changing the SRD §5 outcome. See "Decided rules" below.

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
3. **Inconclusive.** If either G1 check is `inconclusive`, the pre-registered rule applies (see
   "Decided rules"): should the panel order the one larger fresh-seed test set, and how large?
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

## Decided rules (user, 2026-10-11)

1. **Inconclusive G1** (same rule as G2, spec 003 decision 7). If either G1 interval straddles 0.5,
   the panel may order **one** re-score of the committed models on a larger test set generated from
   a fresh, recorded seed. Still inconclusive on that set → G1 **fails**. No re-training, no further
   re-scores.
2. **Tiered verdict** (PR #26; SRD §5 amended). The ratio checks decide. A shuffled-label failure
   voids the evidence (fail). A time-late-not-worse failure makes G1 at best inconclusive until the
   pipeline is investigated. A control failure is reported only: G1 may pass, but the claim is
   "signal exists" without "sequential learning".
3. **No casting vote** (SRD §7 amended). Borderline numbers are handled by rule 1, not by judgement.
4. **Equal-epoch continuation** (user, 2026-10-12, after round 1; SRD §5 amended before the run). A
   variant that failed after stopping on the wall-clock cap with fewer epochs than the other may be
   continued once from its committed weights to the same epoch budget, all else unchanged. The
   first result stays recorded; a second fail is final. Protocol:
   `experiments/20261011-g1-r2/review.md`, "User decision". These rules supersede g1-limits S1.


---

## Round 3 — the time-late continuation

Rounds 1–2 reviewed attempt 1 (`experiments/20261011-g1-r2/`, machine verdict fail: time-late
0.551, 95% CI [0.538, 0.565]) and approved the continuation protocol before the run. Round 3
reviews the continuation as a **new experiment**: all five reviewers, fresh reports, same severity
scale, the same output format as above and the same word limits (**900 words**; re-invitations
**400 words**). Record: `experiments/<id>-r2/review.md` (the continuation's re-scored folder),
linking back to the attempt-1 record.

### What changed (and nothing else may have)

| Item | Attempt 1 | Continuation |
| --- | --- | --- |
| Model trained | `bilstm-time-late` from scratch | `bilstm-time-late` from its committed epoch-23 weights (`weights_digest` 2c5f8784…); epoch 24 dropped |
| `max_wall_s` | 19,800 | 86,400 (the only config change) |
| Stop | wall-clock cap after 25 epochs | `max_epochs` 60 or early stopping, patience 3 |
| Adam state | never saved | restarts once at epoch 24; saved with every checkpoint and restored at job boundaries |
| Patience | counted from epoch 0 | epochs 24–26 not counted (grace after the one restart) |
| Other four models | run 38131616871 | reused from run 38131616871, untouched |
| Training run | 38152208243 | 38208186337 (`train/i1-continue`, commit 7c1c579), one or more jobs |
| Verdict of record | `evaluate-g1.yml` on main | `evaluate-g1.yml` on main (code as at edd0aa2 plus PR #27), all five models re-scored |

Unchanged: data seed 101 and splits, `train_seed` 1002, architecture, loss weights, learning rate,
batch size, test split, bootstrap seed 20261011.

### Pre-registered outcome rules (apply them; do not reinterpret)

From `experiments/20261011-g1-r2/review.md`, "User decision", and SRD §5 (amended 2026-10-12):

1. Both ratio intervals wholly below 0.5 and `shuffled-labels-at-naive` passing → **G1 pass**, even
   if `time-late-not-worse` still fails; the record then says "time-late not shown better than
   instantaneous" and iteration 2 investigates. Note that main's `g1Verdict` reports
   **inconclusive** in that case (tiered rule 2); the panel records the pass under this rule and
   says so.
2. The continued model's ratio interval wholly at or above 0.5 → **G1 fail, final** (SRD §5): no
   further continuation, seed or architecture change.
3. An interval straddling 0.5 → decided rule 1 (one re-score on a larger fresh-seed test set; still
   inconclusive → fail).
4. A cancelled or failed job resumes from its latest checkpoint, never again from epoch 23. The
   first completed continuation is the one scored. Every job is listed with run id, epochs covered
   and `cpu_model`.
5. Attempt 1 stays recorded as a valid attempt.

A reviewer who thinks a rule is wrong raises it as a finding; the rules are not re-opened by
judgement.

### Evidence

| Evidence | Where |
| --- | --- |
| Protocol, attempt-1 record | `experiments/20261011-g1-r2/review.md`; SRD §5 G1 row |
| Verdict of record | `experiments/<id>-r2/` from `evaluate-g1.yml` (`results/g1-eval-<run id>`): `verdict.json`, `bootstrap.json`, `metrics.*`, `curves.csv`, `heldout/`, `models/` |
| Training run's own folder | `experiments/<id>/` from `results/g1-38208186337` (train/i1 code, no bootstrap): informational |
| Continued model | `models/bilstm-time-late/manifest.json` (`epochs`, `best_epoch`, `stop_reason`, `wall_s`, `cpu_model`, `config`, `weights_digest`) |
| Job logs | `gh run view 38208186337 --repo debrief/Gitma` (every job and re-run attempt), `gh run view --log --job <id>`; the committed `logs/time-late.log` may hold only the last job's log |
| Code that changed | `git show 7c1c579`; `git diff origin/main origin/train/i1-continue -- packages/models/src/train.ts packages/models/test/train.test.ts scripts/ configs/ .github/` |
| Seed step | `scripts/train-continue.mjs` on `train/i1-continue` (weights digest and config-diff checks) |
| Attempt 1, for comparison | `experiments/20261011-g1-r2/` (same naive, classical and four reused models) |

Log lines to find, per job:

- Seed (first job only): `seeded bilstm-time-late: resume after epoch 23 (dropped 1 later epoch(s)); weights 2c5f8784…`.
- First job: `resuming bilstm-time-late after epoch 23 (optimizer state restarts; patience not counted for epochs 24–26)`.
- Every later job: `resuming bilstm-time-late after epoch <n> (optimizer state restored)`; `restarts` must appear exactly once in the whole run.
- Every job: the `lscpu` `Model name` line.

### Brief 1 — TMA geometry (round 3)

1. Did the continued time-late curve move the way more training should (lower at every point,
   flatter than instantaneous, since it sees the whole window)? Compare with attempt 1's curve.
2. If `time-late-not-worse` still fails, where along the curve, and is the cause geometric (e.g.
   pre-zig rows dominating the loss) or still training? Say whether rule 1's caveat is the right
   description.
3. Range bands (n beside each; n < 200 anecdotal): does the time-late U-shape (best at 5–10 km)
   persist, i.e. still the prior's shape rather than geometry's?
4. Held-out 20–30 km: does the continued model extrapolate better than attempt 1 (ratio 0.768) or
   stay held to the prior?
5. Are course and speed consistent with the range result?

### Brief 2 — Estimation and numerics (round 3)

1. **Resume and optimizer restore.** From the job logs: the seed line and digest; exactly one
   `optimizer state restarts` (at epoch 24) and `optimizer state restored` at every later job
   boundary. Any job that restarted Adam a second time breaks the protocol (blocker).
2. **Patience grace.** Confirm `e - max(bestEpoch, graceUntil) >= patience` in `train.ts` with
   `graceUntil` 26 after the restart and carried in `optimizer.json` across jobs. If the run stopped
   early, at which epoch, and was the grace applied correctly (not extended, not lost at a job
   boundary)?
3. **Continuity.** Epochs 0–23 in the manifest equal attempt 1's records exactly; attempt 1's epoch 24
   is absent; no jump in train or validation loss at a job boundary beyond the epoch-24 restart.
4. **Training outcome.** Epochs run, best epoch, stop reason, best validation loss vs attempt 1
   (0.565) and vs the instantaneous model at the same epoch. Any divergence or non-finite output?
5. **Baselines unchanged.** Naive and classical metrics byte-identical to attempt 1's
   (`metrics.csv` rows for `naive:` and `classical:`).

### Brief 3 — Evaluation statistics (round 3)

1. Apply the pre-registered rules to `bootstrap.json` and `verdict.json`; state which outcome
   applies. If the machine verdict is `inconclusive` only because `time-late-not-worse` failed, say
   so and apply rule 1.
2. The instantaneous interval should be identical to attempt 1 (0.419, [0.407, 0.431]: same weights,
   data and bootstrap seed). Confirm; any difference is a reproducibility finding.
3. Matched samples: equal `n` and `excluded` for every pair; `bootstrap.json` `n` equals the metrics'.
4. Second attempt: the time-late variant was scored twice. Is the one-continuation rule, fixed
   before the run with a final fail, an adequate guard against a second chance passing by luck?
   Quantify if you can (e.g. the margin of the interval from 0.5). Do not re-open the rule.
5. Medians, P90s, gross-error rates and n reported (constitution IV); no means; the blog draft
   (`site/blog/2026-10-12-iteration-1.md`) complies.

### Brief 4 — Reproducibility (round 3)

1. **Per-job record (rule 4).** List every job and re-run attempt of 38208186337: job id, epochs
   covered, `cpu_model` (from `lscpu`). Did the CPU family change between jobs? If so, record that
   the weights are not byte-reproducible by a single-CPU re-run, and whether it matters.
2. **Seed step.** The continuation started from `weights_digest` 2c5f8784… and the config differs
   from attempt 1's only in `max_wall_s` (the seed step checks both; confirm from its log line and
   the manifest's `config`).
3. **Resume equals uninterrupted.** Run the branch's test (`pnpm vitest run
   packages/models/test/train.test.ts` on `train/i1-continue`): an interrupted-and-resumed run
   gives weights identical to an uninterrupted one.
4. **Reused models.** The four reused models' `weights_digest` equal attempt 1's; data digests in
   every manifest agree.
5. **Re-score locally** from the committed weights (as in round 1): `verdict.json` byte-identical,
   metrics within float32 noise. Confirm `evaluate-g1.yml` picked the continuation's folder, not
   attempt 1's (`ls | sort | tail -1`).
6. **Code lineage.** `train/i1-continue` descends from `train/i1` (schema 0.4.0), not main. List the
   differences that touch training and confirm none other than the protocol's.

### Brief 5 — Red team (round 3)

1. **One change only.** Diff the config, `train.ts`, `batches.ts`, the loss and the workflow against
   attempt 1's code: anything beyond `max_wall_s`, optimizer persistence, the grace and the seed
   step is a finding.
2. **Selection.** Was any job resumed from epoch 23 a second time, any completed continuation
   discarded, or the test split scored before training finished (look at every job and every
   re-run attempt, and at `results/**` and `eval/**` branches)?
3. **Batch order.** Epoch `e` uses the epoch-indexed batch order an uninterrupted run would; a
   resumed job does not replay or skip batches.
4. **Instantaneous untouched.** The instantaneous model is the attempt-1 file (digest), not
   retrained or reselected; the CNN, MLP and shuffled models likewise.
5. **Rules applied as written.** If the outcome is a pass with `time-late-not-worse` failing, check
   the record says "time-late not shown better than instantaneous" and claims nothing more; if a
   fail, check it is recorded as final.
