# G1: what the gate can and cannot detect (T040)

Adversarial notes for the G1 agent review panel ([g1-panel-briefs.md](g1-panel-briefs.md)) and the
iteration-1 blog post. Each limit says what would slip through, and a mitigation or "accepted"
with the reason. Written before the G1 results are known, so none of it is tuned to the outcome.

## What G1 does establish

If G1 passes with its checks, the evidence supports one claim: on clean, simulated, constant-velocity
scenarios (σ = 0.5°, no dropouts, one instantaneous ownship zig), both a causal LSTM and a
bidirectional LSTM estimate range 5 minutes after the zig with a median relative error below half
of a predictor that knows only the training-set prior, on 10⁴ test scenarios, with the paired 95%
interval of that ratio wholly below 0.5. Everything below is about what that claim does not cover.

## Leakage and shortcuts

| # | Limit | What would slip through | Mitigation |
| --- | --- | --- | --- |
| L1 | The shuffled-label check catches harness and label-path leakage (a model reading labels through the batch assembler, loss weights or prediction path), not truth carried in the **inputs**: with shuffled labels, an input channel that encodes the input scenario's truth no longer matches the label, so the shuffled model stays at naive while the real model exploits the channel. | A truth channel in the features would pass the shuffled check *and* inflate the real model. | Covered separately by the counterfactual test (`packages/features/test/leakage.test.ts`): model inputs are byte-identical when target truth and drawn target parameters (including `mean_range_m`, `min_range_m`) change; normalisation constants are identical under shuffled truth. Red-team brief Q1 re-checks the channel list. |
| L2 | A model given truth as an input would be caught by the shuffled-label check only if that input leaks the *label scenario's* truth; under label shuffling it leaks the wrong scenario's, so the shuffled model is no better than naive and the check passes. | The T040 "model given truth as input" case is caught by the counterfactual test (L1), not by the shuffled-label test. | Accepted as stated; the two tests are complementary and both are required. |
| L3 | The shuffled model can learn E[label \| row index, window shape], a slightly richer prior than naive's single constant. | It may sit a little below naive for legitimate reasons, or a little above, without any leakage; the ±10% band may then fail or pass for reasons unrelated to leakage. | Red-team Q2: compare its predictions' spread and training curve with naive. A shuffled model that never trained (flat at initialisation) would also pass vacuously: check its validation loss fell to the label variance. |
| L4 | Generator priors with geometry-free signal: window length, zig timing (40–60% of window) and ownship speed are inputs and are drawn independently of target parameters. | Nothing today: they carry no target information by construction. If a future generator correlates them with the target, the counterfactual test would not notice (it changes the target, not the ownship plan). | Accepted for G1; any generator change must re-check independence of ownship plan and target draw. |
| L5 | Train/test overlap: splits are contiguous index ranges of one seed. | Exact duplicates are impossible by construction (scenario = f(seed, index)); near-duplicate geometries are possible but not systematic. | Accepted. One seed per dataset (42 = G0, 101 = iteration 1) is a process rule, recorded in manifests. |

## Statistics

| # | Limit | What would slip through | Mitigation |
| --- | --- | --- | --- |
| S1 | The bootstrap interval covers **test-set sampling** only: one trained model per variant, resampled scenarios. It does not cover training-seed variance, initialisation, batch order or CPU-dependent training trajectories. | A model that passed by a lucky seed, or would fail on a re-train, shows a tight interval anyway. | Partly accepted (SRD §7 caps the search at a handful of runs). ~~If the G1 ratio is within ≈ 0.1 of 0.5, the panel should ask for a second training seed before deciding.~~ Superseded by the user-decided rules in the panel briefs (no re-training; inconclusive → one larger test set); G1 panel round 1, M4. |
| S2 | Single training seed per model. | Same as S1; also the control comparisons rest on one draw each. | As S1. |
| S3 | `*-beats-control` and `shuffled-labels-at-naive` compare point medians or a fixed band, without intervals. | A narrow win or a band edge decided by sampling noise. | Statistics brief Q5: bootstrap those pairs where margins are small. Proposed for G2: intervals on every check. |
| S4 | `time-late-not-worse` gates only curve points with n ≥ 500 and uses a 5% slack on medians. | Late-window inconsistency (few scenarios have long post-zig legs) is reported, not gated. | Accepted (G0 M6); the points skipped are listed in the check's detail. |
| S5 | Count check for matched samples (`n` and `excluded` equal), not an identity check of the scenarios. | Two estimators each missing different, equally many rows. | Low risk: every estimator emits rows from `zig_index + 1` on the same split, and the bootstrap pairs by scenario index (it would throw on a missing prediction). Accepted. |
| S6 | Early stopping with patience 3 on a noisy validation loss. Observed: the same MLP config stopped at best epoch 20 on an EPYC 7763 runner and 27 on an EPYC 9V74 runner. | A control that loses because it stopped early, or a recurrent model that wins because its control under-trained. | Reported per model (`best_epoch`, `stop_reason`, `cpu_model`). Statistics Q6 and reproducibility Q5. Not fixed for G1. |
| S7 | Gate point fixed at zig + 300 s, overall slice. | A model good only late in the window, or only in some bands, is judged at one point. | The full curves and slices are reported beside the verdict (constitution IV); G1 is a minimal signal test by design. |

## Reproducibility

| # | Limit | What would slip through | Mitigation |
| --- | --- | --- | --- |
| R1 | Weights are byte-reproducible only on the same CPU family (oneDNN kernel choice; research R2). GitHub-hosted runners vary (EPYC 7763, 9V74 observed). | A re-train on another runner gives different weights and possibly a different verdict near the threshold. | `cpu_model` in every manifest; committed weights are the artefact of record; re-scoring them (`pnpm tma-g1`) is the reproducibility test for the verdict. Re-training is reproducible per CPU family only: accepted. |
| R2 | Models may come from two workflow runs (train-plan `reuse_run`), on a training branch that diverges from `main` (predictive wall-clock stop, `max_wall_s` 19,800, schema 0.4.0). | Unrecorded code differences between models; data digests that differ only by header. | Reproducibility brief Q3–Q4: compare each manifest's `git_commit` and dataset digests; record differences in the review. |
| R3 | Training stopped by the wall-clock cap rather than early stopping (BiLSTM ≈ 13 min/epoch: ≈ 25 epochs in 5.5 h). | An undertrained time-late model can fail `time-late-not-worse` or G1 for budget reasons, not signal reasons. | `stop_reason` in each manifest; the panel must say whether a failure is plausibly budget-limited before calling it a G1 fail. |
| R4 | Inference runs on another CPU at re-score time. | Last-digit differences in predictions; medians could shift at float32 precision. | Accepted; reproducibility Q1 reports any difference beyond that. |

## Scope of the simulation

| # | Limit | What would slip through | Mitigation |
| --- | --- | --- | --- |
| D1 | Constant-velocity target, single target, no false detections. | Nothing about manoeuvring targets or clutter. | Accepted (SRD §1, §8: "high but accepted"); later phases. |
| D2 | Instantaneous ownship zig, exactly one per scenario, at 40–60% of the window. | Real turns take minutes; observability builds gradually. The model may key on the abrupt change in ownship course channels. | Accepted for the proof; G2 can test a finite turn rate only via an SRD amendment. |
| D3 | σ = 0.5° only, no dropouts. | Nothing about robustness to noise or gaps; that is G2's question. | Accepted (SRD §7 iteration 1). Slices by σ have a single value in G1. |
| D4 | Range 2–20 km log-uniform; held-out 20–30 km scored but not gated. | A model that clamps to the training range passes G1. | Held-out results reported; geometry brief Q5 judges them. |
| D5 | Exact ownship navigation; flat-earth frame. | Navigation error sensitivity. | Accepted (SRD §8 assumptions). |
| D6 | Time-late at zig + 300 s uses bearings after that time. | A reader taking it as a real-time result. | Legitimate by SRD §4 (post-hoc reconstruction); the blog and results page must label it so. |

## Process

| # | Limit | Mitigation |
| --- | --- | --- |
| P1 | No pre-registered handling of an `inconclusive` G1. | Panel records its rule before reading numbers (briefs, "Open questions" 1). |
| P2 | The machine verdict fails on any failed check, while SRD §5's G1 is the ratio alone. | Panel records the reading for each check type (briefs, "Open questions" 2). |
| P3 | Reviewers are AI agents briefed by the same project; correlated blind spots are possible. | Five distinct specialities, independent first round, evidence-cited findings; the red-team brief is told to assume the result is wrong. Accepted. |
| P4 | Classical per-timestep non-converged rows are +∞, so classical medians near the zig may be absent. | Reported with `non_converged_rate`; numerics brief Q1. G3 parity will compare on rows both estimators answer. |
