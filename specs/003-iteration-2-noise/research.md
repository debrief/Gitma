# Research: Iteration 2 — Is the Solution Useful Under Noise?

Phase 0 output for [plan.md](plan.md). Each item: decision, rationale, alternatives. Items marked
**[G1-dependent]** are provisional until the G1 panel decides; **[USER]** needs user confirmation.

## R1. Iteration-2 dataset

- **Decision**: 10^5 scenarios, dataset seed **201** (process rule from the G0 review: one seed per
  dataset; 42 = G0, 101 = iteration 1). `configs/iter2-ranges.json` = iteration-1 ranges with
  `noise_sigma_rad_values = [1°, 2°]` and `dropout_fraction = [0, 0.10]`;
  `configs/iter2-heldout-ranges.json` the same with initial range 20–30 km. Dropouts are the
  generator's existing per-sample Bernoulli draws with a per-scenario probability (no generator
  change needed for noise or dropouts).
- **Rationale**: SRD §7 "σ = 1–2°, 10% dropouts" read with SRD §3's value set (0.5°, 1°, 2°) and
  "0–10% of samples missing at random". A uniform per-scenario fraction gives a dropout slice to
  report and keeps the 10% end in the data. Two σ values put ≈ 5,000 test scenarios in the gated
  σ = 1° slice, enough for a tight median CI (R8).
- **Alternatives**: fixed 10% dropout in every scenario (literal §7 reading; loses the slice and is
  harsher than §3's range; flagged in spec Assumptions); σ ∈ {0.5°, 1°, 2°} (dilutes the gated slice
  by a third, and 0.5° was iteration 1); 3×10^5 scenarios to offset noise (epochs per 5.5 h job drop
  threefold, R4); separate models per σ (doubles training, and an operator's model must cope with
  both).

## R2. Dataset provenance and training lineage (deferred from G0 panel round 3)

- **Decision**:
  - `DatasetHeader` gains `generator_git_commit` and `generator_git_dirty` (schema 0.5.0, optional
    slots so 0.4.0 files still parse; training treats absence as a refusal). `tma-generate` reads
    them with `git` in the package checkout (as the G0 manifest does) and refuses a dirty tree
    unless `--allow-dirty`.
  - The `.features.bin` header (format version 2) embeds the source `DatasetHeader` and its digest,
    plus the feature set (R6). Version-1 files remain readable for iteration-1 re-runs.
  - `tma-train` adds a lineage check to the existing G0 guard: source header present, not dirty,
    and `git diff --quiet <G0 commit> <header commit> -- packages/sim/src packages/data/src`
    (the guard's `GENERATOR_PATHS`). The check needs both commits in history (CI already fetches
    full history).
- **Rationale**: closes the red team's round-3 gap (data from since-reverted code would pass the
  current-tree check). Carrying the header into the features file is the only way the lineage
  survives the features stage, since training never reads the `.f32pack`.
- **Consequence (critical)**: this edits `packages/data/src`, a protected path, so the G0 guard will
  refuse training until G0 is re-run on the new commit and the panel approves (FR-004). It must not
  be merged while the G1 panel might still ask for a G1 re-training run.
- **Alternatives**: hash `packages/sim/src` + `packages/data/src` into the header instead of a commit
  (robust to history rewrites but cannot be checked against the G0 commit without recomputing at
  that commit; rejected as more machinery); record provenance only in the experiment manifest
  (the gap the red team named; rejected).

## R3. Rate-limited ownship turn — in iteration 2? **[USER]**

- **Decision (recommended)**: **include it in iteration 2**, in the same PR and G0 re-run as R2.
  Turn at constant speed and constant rate, rate drawn per scenario uniformly in **0.5–3°/s**
  (90° takes 30–180 s); `zig_fraction` sets the turn start; `zig_index` stays "first sample on leg 2",
  now the first sample after the turn completes; new metadata `turn_start_index`, parameter
  `ownship_turn_rate_rad_s` (both optional in schema: absent = instantaneous, so 0.4.0 data still
  reads). Position on the arc is closed-form (centre + radius `v/ω`), float32-rounded as usual.
  `GENERATOR_VERSION` 0.1.0 → 0.2.0.
- **Rationale**:
  - SRD §3 schedules it: "Turn modelled as instantaneous in iteration 1, then rate-limited".
  - R2 already forces a G0 re-run and panel review; doing the turn now costs one G0 cycle, not two.
  - G2 is the last stop gate; judging "useful" on a physically impossible instantaneous turn is the
    weakest point in the evidence, and SRD §8 lists the simplification as a high-likelihood risk.
  - Downstream code is unaffected: the classical solver and features use stored ownship states, and
    keeping `zig_index` = first leg-2 sample leaves loss masking, gate point and curves unchanged
    ("5 min on the new leg", as in G1).
- **Costs and risks**: confounds the G1→G2 comparison (noise, dropouts and turn change together).
  Mitigation: score the G1 models (no retraining) on a small σ = 0.5°, no-dropout, rate-limited test
  set to isolate the turn effect, reported not gated. Fewer scenarios reach zig + 300 s (longer
  effective zig); reported as `excluded`. Frame errors in new geometry are not caught by G0
  (AGENTS.md gotcha): known-answer arc tests and the G0 independent-geometry check need an
  in-turn case.
- **Alternatives**: defer to iteration 3 (keeps iteration 2 a pure noise experiment and G1/G2
  comparable; but iteration 3 is not a stop gate, and a later G0 re-run would be a second one);
  model the turn as a rate-limited heading change with a speed loss (more realistic, more parameters,
  no SRD basis; rejected).
- **If the user defers it**: drop US6/FR-006/T-tasks marked US6; R2 still requires a G0 re-run.

## R4. Training on GitHub Actions

- **Decision**: generalise the iteration-1 `train.yml` (branch `train/i1`) **[G1-dependent: its
  merged form]** to a plan file: `configs/iter2/<phase>/plan.json` lists the dataset command, the
  feature set, the five model configs and the evaluation step. Push to `train/i2a` or `train/i2b`
  runs one job per model (`timeout-minutes: 358`, `max_wall_s: 19800` with the predictive epoch
  stop), then an evaluation job (`timeout-minutes: 240`) that pushes `results/i2<phase>-<run id>`.
  Each job regenerates data from seed 201 (byte-identical) and checks the printed digests match the
  plan's expected digests.
- **Rationale**: the container used for iteration 1 is reclaimed when idle; GitHub-hosted runners
  ran iteration 1 (≤ 5.5 h each, in parallel). Public repo: Actions minutes are free.
- **Budget**: ≈ 12.6 min per LSTM epoch measured in iteration 1 → ≈ 25 LSTM / ≈ 13 BiLSTM epochs per
  job. Noise slows convergence; patience stays 3 unless G1 manifests show early stopping triggered by
  validation noise **[G1-dependent]**.
- **Alternatives**: one job training all models sequentially (exceeds 6 h); self-hosted runner (no
  such machine); warm-start phase A from G1 weights (cheaper, but the noisy-data result then depends
  on the clean-data run; kept as a fallback only if phase A hits the wall-clock cap with validation
  loss still falling, and recorded as the change if used).

## R5. Phase structure and protecting the test split

- **Decision**:
  1. Phase A trains the carried architectures on raw features.
  2. Phase A is scored on the **validation** split (naive + models; classical not needed for
     absolute thresholds) with the G2 criteria and CIs.
  3. If any gated criterion fails or is inconclusive on validation ("raw features stall", SRD §4),
     a decision record `experiments/<id>/decision.md` fixes the single change (R6 default) and the
     carried-set rule, and is committed **before** phase B training.
  4. Phase B trains all five runs with the change; scored on validation.
  5. The carried set (A or B) is chosen by the pre-declared rule (default: B unless B is worse than
     A on the σ = 1° validation range median by more than its CI), then the test split is scored
     once for both sets; G2 is judged on the carried set; the other set is reported beside it.
- **Rationale**: SRD §7 allows one round of changes; choosing it after seeing test metrics would
  turn the test split into a validation split. Commit order is the audit trail (SC-005).
- **Alternatives**: judge phase A on test and then phase B on test (two looks at the test split;
  rejected); always run phase B (more information, ≈ 6 h more CI; offered to the user in spec
  Assumptions **[USER]**).

## R6. The candidate change: derived features (SRD §4)

- **Decision**: feature set `derived` = the 10 raw channels plus:
  - `bearing_rate_scaled`: causal least-squares slope of unwrapped bearing against time over the
    valid samples in the trailing 18 rows (3 min, including t), unwrapped relative to the latest
    valid bearing; divided by `bearing_rate_scale_rad_s` (90th percentile of |rate| over training
    inputs).
  - `rate_valid`: 1 if ≥ 3 valid samples were in the trailing window, else 0 (rate = 0).
  - `intercept_scaled`: `(x_o cos b − y_o sin b) / position_scale_km` (km) on valid rows, 0 on
    dropout and padding. This is the pseudo-linear measurement: a target at (x, y) on the bearing
    line satisfies `x cos b − y sin b = x_o cos b − y_o sin b`, so with constant velocity every row is
    one linear equation in (x₀, y₀, vₓ, v_y) given `sin b`, `cos b`, `t` and this channel.
- **Why a trailing window**: a 10 s finite difference is useless at σ = 2° (noise ≈ 0.28°/s against
  true rates of ≈ 0.005–0.3°/s across the range band); an 18-sample LS slope has noise ≈ 0.009°/s at σ = 2° and
  ≈ 0.0045°/s at σ = 1°. It is causal, so the instantaneous models keep FR-006 causality.
- **Rationale**: SRD §4 names these two features for exactly this case; they are cheap (3 channels,
  negligible throughput cost), portable, computed from inputs only (no leakage), and they encode the
  structure a classical pseudo-linear estimator uses, which is the most likely thing the raw-input
  networks failed to discover under noise.
- **Alternatives** (any one may replace the default if phase A evidence points elsewhere; recorded in
  the decision record): two-layer LSTM (`layers: 2`, Keras-plain; the right choice if training loss
  is high, i.e. capacity-bound); larger units within 64–128; σ as an input channel (operators know
  their sensor; but it changes what the model is told, and the gate slices on σ); loss reweighting
  (if one quantity lags); attention or GRU (not in the constitution's layer list; rejected).
- **[G1-dependent]**: if G1 shows a recurrent model failing to beat its control, the change should
  address sequence use (e.g. two-layer LSTM) rather than features.

## R7. G2 definition

- **SRD §5 wording (verified)**: "G2 — useful | Median range error < 20%, course < 10°, speed < 1 kt
  at σ = 1° | Iterate features/architecture once; if still failed, stop". §7 exit: "One more
  iteration allowed, then stop". (The task brief cites §8 for iterations; they are in §7.)
- **Decision**: slice `sigma=1deg`, point `zig+300s` (SRD §5: instantaneous thresholds at 5 min after
  the zig; applied to time-late as in G1), statistics `range_rel_median < 0.20`,
  `course_deg_median < 10`, `speed_kt_median < 1.0`, each for both recurrent variants **[USER]**;
  model, naive and classical scored on the same rows (matched `n`/`excluded`, as G1). Checks:
  `g2-<variant>-{range,course,speed}` (six), plus the iteration-1 checks re-run on noisy data
  (`g1-*`, `time-late-not-worse`, `*-beats-control`, `shuffled-labels-at-naive`).
- **Rationale**: mirrors G1's per-variant structure; all three thresholds are SRD text.
- **Open**: "useful" could reasonably mean the instantaneous variant alone (it is the operator's
  running solution); the user decides. Thresholds are not moved even if R12 shows them hard.

## R8. Confidence intervals (deferred from G0 panel)

- **Decision**: percentile bootstrap over scenarios of the slice, B = 2,000, PRNG seeded from the
  experiment seed (SplitMix64, determinism). One row per scenario at zig + 300 s, so scenario and row
  resampling coincide. Paired resampling for ratio checks (model/naive) and the classical comparison.
  A check is `inconclusive` if its 95% CI contains the threshold; the gate is `pass` only if all
  checks pass, `fail` if any fails, else `inconclusive`. The leakage band and consistency slack keep
  their G1 rules without CIs.
- **Expected width**: median of ≈ 5,000 heavy-tailed values; ±(1–2)% relative on range is typical,
  so inconclusive only near the thresholds.
- **Alternatives**: order-statistic (binomial) CI for the median (analytic, no PRNG; but no paired
  version for ratios); no CIs (the panel already asked for them).
- **[G1-dependent]**: if spec 002 T033 implements the bootstrap for G1, iteration 2 reuses it.

## R9. Classical comparison on common rows (deferred from G0 panel)

- **Decision**: for each model and slice at zig + 300 s and `final`, metrics on rows where both the
  model and classical produced a converged, finite estimate; coverage of each (answered / scored)
  reported separately; written to `comparison.csv` (`PairedComparison` records). Reported only;
  G3 (iteration 3) will gate on it.
- **Rationale**: +∞ scoring makes classical P90 infinite once non-convergence exceeds 10%, which
  becomes likely at σ = 2°; comparing on common rows plus coverage is the panel's agreed answer.

## R10. Window-mean position error for time-late (SRD §5)

- **Decision**: per scenario, mean |p̂ − p| over the predicted rows (rows after the zig — the rows
  every estimator emits); summarised as median and P90 across scenarios; reported for time-late
  models and naive/classical beside them; not gated. New `MetricsRecord` slots
  `position_window_m_median`, `position_window_m_p90`.
- **Note**: SRD says "over the window"; models only emit post-zig rows (spec 002 R7). Emitting
  pre-zig rows for time-late is possible but would be scored against estimators that have none.

## R11. Dropout slice

- **Decision**: `dropout_band=0-5pct`, `dropout_band=5-10pct` from the drawn `dropout_fraction`
  (not the realised count). Constitution IV requires range/zig/σ slices; dropout is added.

## R12. Achievability check before training

- **Decision**: before training, run naive and classical per-timestep on the iteration-2 test split
  and record classical's σ = 1° medians at zig + 300 s against the G2 thresholds. Not a gate.
- **Rationale**: the G0 reviewers noted 8.75% classical gross-error rate at σ = 1°. If the classical
  solver cannot meet 20% median range error at zig + 300 s, G2 at that point may be beyond what the
  geometry supports; the user should know that before ≈ 12 h of training. The SRD threshold is not
  changed by this check.
- **Result (2026-10-11, preliminary, current generator without the rate-limited turn)**: iteration-1
  ranges with σ = 1° and dropouts 0–10%, classical per-timestep, seed 302, 3,000 scenarios
  (zig + 300 s: n = 2,919; 81 windows too short):

  | Point | Range median | Course median | Speed median (95% CI) |
  | --- | --- | --- | --- |
  | zig + 300 s | 9.3% | 3.7° | **1.28 kt (1.19–1.36)** |
  | zig + 600 s | 4.6% | 1.7° | 0.61 kt (0.56–0.67) |
  | zig + 900 s | 3.0% | 1.1° | 0.39 kt (0.35–0.44) |
  | final | 5.0% | 1.9° | 0.64 kt (0.59–0.70) |

  A 1,000-scenario run (seed 301) gave the same picture and, for reference, naive at zig + 300 s:
  36% range, 89° course, 4.2 kt speed; at σ = 2° classical reached 17.8% / 6.8° / 2.27 kt.
  **The classical solver meets the range and course thresholds at zig + 300 s but not speed**: its
  95% interval lies wholly above 1 kt. As written, G2 asks the model to beat the classical
  reference on speed at the 5-minute point, while G3 asks only for near-parity. Raised with the user
  (SRD §5 interpretation); to be re-run on the final iteration-2 generator (with the turn).

## R13. Schema versioning

- **Decision**: schema 0.4.0 → 0.5.0, additive (all new slots optional or new classes; one new enum
  value `inconclusive` on `GateResult`). Data goldens change (header provenance; turn if R3).
  Iteration-1 datasets remain readable for inspection; training refuses them (R2).

## R14. Site

- **Decision**: `site/docs/results/iteration-2.mdx` reusing `ResultsReview` with a slice selector
  (σ, dropout band) and a CI column; blog post with the decision; updates to
  `algorithms/feature-layout.md` (derived set), `algorithms/generator.md` (turn, provenance),
  `evaluation.md` (G2, CIs, common-row comparison, window-mean position); glossary: bearing rate,
  bearing-line intercept, pseudo-linear measurement, dropout, confidence interval, inconclusive,
  rate-limited turn, provenance.

## R15. Training speed (side experiment, 2026-10-12)

**Question**: can training run faster without changing the models? Time-late took 775–1,066 s per
epoch on GitHub runners, so 60 epochs need 13–18 h.

**Method**: timed Adam steps on real seed-101 training windows, using the iteration-1 layers (Masking,
LSTM or BiLSTM 96, time-distributed Dense 4) with inputs trimmed to L rows. The grid covered
L ∈ {240, 150, 105}, batch size ∈ {256, 512} and threads (default, 4/1, 2/1, 1/1 intra/inter-op).
Two warm-up steps, then the mean of 4 steps, on a 4-core Intel Xeon 2.1 GHz container. The script
is in the session scratchpad and is not committed.

**Findings** (ms per training window):

| Model | 240 rows, batch 256, default threads (today) | 1 thread | 1 thread, 150 rows | 1 thread, 150 rows, batch 512 |
| --- | --- | --- | --- | --- |
| LSTM | 9.11 | 6.50 | 3.74 | 3.22 |
| BiLSTM | 15.67 | 12.50 | 8.96 | 6.28 |

- **Threads**: a single intra-op thread is fastest at every size. tfjs-node's thread pool costs more
  than it saves on these small recurrent matmuls (high system time). It is free and does not change
  the model.
- **Window length**: step time scales roughly linearly with rows. Windows have 60–240 valid rows
  (mean 150; 38% of every 240-row window is padding). Today almost every batch contains one
  full-length window, so the batch runs all 240 rows.
- **Bucketing**: sort windows by length within groups of 16 batches of the epoch's seeded
  permutation, cut batches, then shuffle the batch order with the same seed. A batch then has a mean
  of 156 rows (65% of today's compute); sorting the whole epoch gives 151 rows (63%). Masking is
  already exact, so trimming trailing padding cannot change a model's outputs. It does change batch
  composition, so it is a training-procedure change, made once and declared at the start of an
  iteration.
- **Batch 512**: another 1.2–1.4× per window, but half as many optimizer steps per epoch. It needs a
  learning-rate check, so it is not adopted by default.

**Decision (proposed for iteration 2)**: single-thread tfjs and length bucketing, together about 1.8×
(BiLSTM) and 2.4× (LSTM) on this CPU. Before adopting, confirm the thread result on a GitHub runner
(AMD EPYC), whose thread behaviour may differ. Keep batch 256 and the learning rate. Optional: a
validation-only learning-rate-schedule probe.

## R16. Noise smoke test (side experiment, 2026-10-12)

**Question**: does the pipeline work end to end with σ = 1° and 0–10% dropouts, and does the model
still learn?

**Method**: scratch seed 9001, 20,000 scenarios. Two arms: noisy (σ = 1°, dropouts 0–10%) and clean
control (σ = 0.5°, no dropouts), on the same geometries. Each arm used the iteration-1 LSTM
config with max_epochs 20 and a single thread, and was scored on the validation split only
(n = 1,950 at zig + 300 s) with naive and classical per-timestep alongside. Outputs are in the session
scratchpad and are not committed.

**Findings** (median, zig + 300 s):

| Arm | Naive range | Classical range | LSTM range | LSTM course | LSTM speed |
| --- | --- | --- | --- | --- | --- |
| Clean | 0.397 | 0.048 | 0.339 | 29.7° | 4.12 kt |
| Noisy | 0.397 | 0.098 | 0.385 | 35.0° | 4.34 kt |

- **Pipeline**: dropouts flow through features, training, prediction and scoring with no NaNs,
  crashes or masking errors. Dropout rows keep ownship and time channels with `valid = 0`.
- **Classical at σ = 1°**: 9.8% at zig + 300 s, matching R12 (9.3%).
- **Noise cost**: +13% median range error for the LSTM, about 2× for classical.
- **Scale**: at 16k training scenarios and 20 epochs the LSTM barely beats naive on range, against
  0.16 for the full 80k / 60-epoch iteration-1 model. Learning range needs the full data and epoch
  budget, so small pilots cannot forecast G2 and phase A must run at full scale.
