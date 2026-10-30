# Models (iteration 1)

Source: `packages/models/src/`. Requirements: SRD §4, spec 002 (research R3–R7).

Four small models, built only from layers with direct Keras equivalents (constitution III). Each
maps the [240 × 10] input window ([feature layout](feature-layout.md)) to [240 × 4] outputs per row:
`log_range_km`, `course_sin`, `course_cos`, `speed_scaled`. Position is derived, not learned.

| Model (`model_kind`) | Role | Layers | Causal? |
| --- | --- | --- | --- |
| `lstm-instantaneous` (`instantaneous`) | G1 variant | Masking → LSTM(96) → TimeDistributed(Dense(4)) | yes |
| `bilstm-time-late` (`time_late`) | G1 variant | Masking → Bidirectional(LSTM(96)) → TimeDistributed(Dense(4)) | no |
| `cnn-causal-control` (`causal_cnn`) | control for the instantaneous LSTM | 3 × (left-pad 14 → Conv1D(64, k = 15, ReLU)) → TimeDistributed(Dense(4)) | yes |
| `mlp-control` (`mlp`) | control for the BiLSTM | Flatten → Dense(256) → Dense(256) → Dense(960) → Reshape | no |

The controls answer "is the sequence model doing anything a simpler model can't?". The causal CNN
sees only the last 43 rows (≈ 7 min), so it is a local-pattern model; the MLP sees the whole window
but has no notion of order beyond position.

`layers` stacks recurrent layers for the two LSTM kinds (each returns sequences; default 1). It is
used by the iteration-2 capacity scan (research R20), a validation-only side experiment that
`tma-scan` scores beside naive and classical; no gated model has used it.

## Loss

Targets and a per-row weight are packed into `y_true` [240 × 5]. Per row:

`w_r·(Δ log r)² + w_c·(Δ sin² + Δ cos²) + w_s·(Δ speed)²`, averaged over rows with weight > 0.

With the **velocity** output parameterisation (`output_parameterisation: velocity`, iteration 4,
spec 008) the outputs are `log_range_km`, `vx`, `vy` and an unused fourth channel. The velocity
components are the target's east and north velocity divided by `velocity_scale_mps` (the top of the
generator's target speed range, a constant of the problem). The training targets are re-encoded
from the stored course and speed, so the features files do not change. Per row the loss is then

`w_r·(Δ log r)² + w_s·(Δ vx² + Δ vy²)`,

with no course term and no loss on the fourth channel. A course error δ on a target at speed v
costs about `w_s·(v·δ / velocity_scale_mps)²`, so course on slow targets weighs less than under
course_speed. The fourth channel is never read when decoding. Untrained, it drifts freely (up to
about ±0.8 on the iteration-4 LSTM); this has no effect on any estimate.

With the **two-hypothesis** output (`velocity_two_hypothesis`, phase 3b, spec 011) the model has
seven outputs per row:
- hypothesis 0, the target has not turned: log range, vx, vy;
- hypothesis 1, the target has turned: the same three;
- a logit z of P(the target's turn has started by this row).

The label l is 1 from the first row whose stored truth course differs from row 0's
(`turnedLabel`). A target that holds course has the same stored course on every row. The loss per
row is

`(1 − l)·[w_r·(Δ log r₀)² + w_s·(Δ vx₀² + Δ vy₀²)] + l·[the same for hypothesis 1] + w_m·BCE(z, l)`,

with `w_m = loss_weight_manoeuvre`, so each hypothesis learns only from rows where it is true.

Decoding reports hypothesis 1 when P = σ(z) > 0.5 and hypothesis 0 otherwise, never a mixture,
and records P on the row (`p_manoeuvre`). The design answers phase 3's finding. With a single
velocity output, squared error made the network report the average over "turned" and "not
turned", which biased speeds low and hedged courses on targets that held course.

With the **Gaussian** output (`velocity_gaussian`, phase 4 tracker T2, spec 012) the model has six
outputs per row: the means of log range, vx and vy, then the log-variance s of each. The loss per
term is the Gaussian negative log-likelihood ½(e² e^(−s) + s), weighted as the squared error would
be, with s clipped to [−12, 6]. Decoding reports the mean, and the row carries the standard
deviations (`log_range_sd`, `vx_sd_mps`, `vy_sd_mps`). Their calibration is reported, never
gated (Annex C §C.4).

Phase 4's other tracker, T1, is not built from these layers: it is a single declared filter layer
([learned-gain filter](learned-gain-filter.md)).

Windows have `rowsFor(ranges)` rows: 240 up to phase 3, and 360 for generator 0.5.0's 60-min
windows. The features file records the count, and models are built to it.

The weight is the post-zig loss mask for causal models (before the zig, range is unobservable, so
the instantaneous model is not trained to guess it) and the window mask for non-causal models,
which see the whole window anyway. Every model is still **scored** only after the zig.

## Training

- Adam, batch 256, learning rate 10⁻³; one epoch = one seeded permutation of the 80,000 training
  windows, read from disk scenario by scenario (never loaded whole).
- After each epoch: validation loss on all 10,000 validation windows; best-epoch weights kept.
- Stops at the first of: `max_epochs`, `patience` epochs without improvement (early stopping),
  the wall-clock cap (`max_wall_s`), or a non-finite loss (`diverged`).
- Checkpoint every epoch (saved atomically: written to a temporary folder, then swapped in); a
  restarted run resumes and the wall-clock cap counts the time already spent.
- Each checkpoint also saves the Adam state (`optimizer.json`, `optimizer.bin`), so a resumed run
  gives the same weights as an uninterrupted one (tested). A checkpoint without it (for example
  one seeded from committed weights by `scripts/train-continue.mjs`) restarts Adam; the next three
  epochs then do not count towards patience, and the log says so.
- A seeded continuation may change the loss (iteration 2b weighted speed 4×). On a restart the best
  weights are re-scored under the new loss, and that value is written to the manifest as
  `best_val_loss` so a later chained job compares against the same number; otherwise the recorded
  old-loss value, always lower, could never be beaten and the old weights would be kept silently.
  The manifest's `continued_from` names the source weights, epoch and loss; the epoch records up
  to that epoch keep their old-loss values.
- On GitHub Actions each job pushes its output folder to a `checkpoints/<branch>/<model>` git
  branch after every epoch and restores it at start, so a cancelled or crashed job resumes and a
  completed model is not retrained. Once the results branch is pushed, the run deletes its
  own checkpoint branches and any whose train branch no longer exists.
- Training refuses to start without a passing G0 verdict in `experiments/`, or on features whose
  dataset lineage or feature set does not match ([provenance](generator.md#provenance)).
- **Input width** follows the features file: 10 channels for the `raw` set, 13 for `derived`
  ([feature layout](feature-layout.md#derived-feature-set)). The config's `feature_set` must
  match the file's; prediction refuses a features file of another set than the model was
  trained on (`feature-set-mismatch`). Length bucketing works the same at either width.

### Training plans (iteration 2)

`.github/workflows/train.yml` trains a **plan**, `configs/<plan>/plan.json`, chosen by the branch
(`train/i2a` → `configs/iter2/a/plan.json`) or a manual `plan` input. The plan pins the dataset
(seed, ranges and the SHA-256 of each split's scenario blocks, header excluded because the header
records the generator commit), the feature set, the model configs and the evaluation
(`tma-g2 --split validation` for a phase run). Every job regenerates the data and checks those
digests. Each model trains in up to three chained jobs of ≤ 345 min (decision 9: 60 epochs,
patience 3, no binding wall-clock cap); a later job resumes from the checkpoint branch, and a job
whose model is complete runs only `tma-train --check` (G0 guard and lineage). An iteration-2 plan
cannot use the G0 or iteration-1 seeds (42, 101) or another iteration's ranges files. Phase A's
configs are the iteration-1 ones with decision 9's budget, one tfjs thread, length bucketing
(except the MLP, whose dense layers need all 240 rows) and `feature_set: raw`.

## Training speed options (iteration 2)

Two optional `TrainingConfig` fields can speed training up (research R15). Both are off by default, so
the iteration-1 configs train exactly as before (the model golden test is unchanged). Each one is a
training-procedure change: declare it at the start of an iteration, not partway through.

**`length_bucketing`** (default `false`; group size `bucket_batches`, default 16). Windows have
60–240 valid rows, but a batch usually contains one full-length window, so it runs all 240 rows.
With bucketing, each epoch:

1. takes the epoch's seeded permutation as before;
2. splits it into groups of `bucket_batches × batch_size` windows;
3. sorts each group by window length (ties keep their permutation order) and cuts it into batches;
4. shuffles the order of all the epoch's batches with a seed derived from `train_seed` and the epoch
   (a separate SplitMix64 stream);
5. trims each batch to its longest window's rows.

Every window is still seen exactly once per epoch, and the same seed gives the same batches. A
window's length is one past its last row with any non-zero input; padding rows are all zero and
dropout rows keep their ownship and time channels, so a dropout is never cut. The trimmed rows had
zero loss weight, and the Masking layer already skipped them, so trimming leaves every kept row's
output unchanged, bit for bit, including the backward direction of the BiLSTM (it starts from the
last real row either way). Tests check this for outputs, loss and one gradient step. What changes is
which windows share a batch, so the training trajectory differs from an unbucketed run.

With bucketing on, the LSTM, BiLSTM and causal CNN are built with a variable time dimension
(`[null, 10]` instead of `[240, 10]`; the CNN's reshapes use −1). The layers, parameter count and
seeded initial weights are the same, and full-length input gives identical outputs, so prediction
and scoring are unchanged. The MLP's dense layers read all 240 rows, so training refuses
`length_bucketing` for it. Validation always uses full windows.

**`tfjs_threads`** (integer, optional). libtensorflow sizes its thread pools from
`TF_NUM_INTRAOP_THREADS` and `TF_NUM_INTEROP_THREADS` once, when tfjs-node loads. `tma-train` reads
the config first, sets both variables to `tfjs_threads`, and only then imports the trainer (and with
it tfjs-node). Setting the variables in the shell has the same effect. A single thread was fastest for
these small recurrent matrix products on a 4-core Xeon. The manifest records the values in force as
`tf_intraop_threads` and `tf_interop_threads`; when they are absent, the variables were unset and
TensorFlow used one thread per core. Thread count does not change the model, but it can change the
order of floating-point sums, so weights are only promised byte-identical for the same CPU family
and thread settings.

A benchmark workflow (`.github/workflows/bench-train.yml`, run on a push to `bench/**`) times
training steps for the LSTM and BiLSTM, padded or bucketed, with default or single threads, on a
GitHub runner.

## Determinism

Every initializer has a seed derived from the config's `train_seed` (SplitMix64), and the batch
order comes from the project PRNG. Two runs on the same machine give byte-identical weights (golden
test on a tiny config). Across CPU families oneDNN may pick different kernels, so weights are not
promised identical there; the manifest records `cpu_model`. From schema 0.6.0 it also records
`git_commit` and `git_dirty`, read when training starts; a resumed run keeps an earlier job's dirty
flag and logs a change of commit. Models trained before 0.6.0 have neither field.

## tfjs workarounds

- `conv1d({ padding: "causal" })` silently behaves as `"valid"` in tfjs; causal padding is built as
  Reshape → ZeroPadding2D (left only) → Reshape → Conv1D(valid).
- tfjs-node 4.22 has no gradient for dilated convolutions, so the CNN widens its receptive field
  with k = 15 instead of dilation.
- `trainOnBatch` rejects the 5-channel packed target, so the step calls `optimizer.minimize`
  directly.

## Predictions

`tma-model-predict` writes rows from `zig_index + 1` to the end (as the classical solver): range
`1000·exp(log_range_km)`, course `atan2(sin, cos)`, speed `speed_scaled × speed_scale_mps`
(velocity: course `atan2(vx, vy)`, speed `‖(vx, vy)‖ × velocity_scale_mps`), and
position from range along the last valid bearing (as the naive baseline). Non-finite outputs give
`converged = false`, scored as gross errors.

A model is only run on features normalised exactly as its training data was. The one tolerated
difference is a train-split header that differs only in `schema_version` (a schema bump after
training, same data and constants); `tma-g1` logs it and records it in the experiment manifest, and
`tma-model-predict` accepts it when given `--train <train.f32pack>`.

## Gate scoring and the re-score (iteration 4)

`tma-g2 --split test` scores the carried models, naive and classical on the test split (and the
held-out split, FR-019), with the other phase beside. Scoring **streams**: each estimator's
predictions are written to `predictions/<split>.<estimator>.ndjson` batch by batch, and the
evaluation reads them back by scenario index from the files (`openPredictionSet`), with truth
re-read from the `.f32pack` on every pass, so memory no longer grows with estimators × scenarios ×
rows. Outputs are byte-identical to the in-memory path (checked on the seed-205 gate). Before
anything is scored, every truth and features file the run needs must exist (a run never stops after
writing `verdict.json`), and `verdict.json` is written last.

SRD §7 allows **one re-score** of an inconclusive G2 on a larger fresh-seed test set, then a fail.
`tma-g2 --rescore-of <experiment>` (or a decision whose `rescore_of` is set; schema 0.11.0) runs it
and refuses unless all of these hold:

- the split is test, from a clean tree (no `--allow-dirty`), with a committed decision that names
  this re-score (`rescore_of`), the plan, its `fresh_test_count` and a `test_seed` equal to the
  plan's `fresh_test` seed and to the test data's own header, which must record a clean tree;
- the plan differs from its content at the commit that added the decision only in
  `dataset.fresh_test.digest` (pinned once the data exist), and the decision's last change
  precedes or is the plan's (so it cannot be edited after the pin);
- the test data have the generator version and parameter ranges of the re-scored gate's test
  split (the same problem);
- the re-scored experiment holds a committed, panel-decided (`decided_by` names an agent panel
  round), inconclusive G2 `verdict.json` and a committed `manifest.json`, tested another seed,
  and is not itself a re-score;
- the decision's `model_digests` (schema 0.11.1) name exactly the carried models, each with the
  SHA-256 of its `weights.bin`, `manifest.json` and `model.json`, each tracked and unmodified in
  git; the weights digest must also
  equal the model manifest's `weights_digest` and the one the re-scored gate's manifest recorded.
  This replaces the training-ancestry rule (decision committed before the weights), which still
  applies to every other test run;
- one re-score per gate: the experiment is a new folder beside the re-scored one, with no
  `verdict.json` or `rescore.json` marker; no sibling holds a marker or manifest note naming the
  same gate; no other committed sibling `decision.json` names it.

The run writes `rescore.json` (rescore_of, decision, start time, commit) before it scores
anything, so a re-score that stops part-way still counts as the one re-score.

An aborted re-score (the cloud container that ran it was reclaimed) can be finished with
`--reuse-predictions <reuse.json>`, in re-score mode only. The file is committed before the run and
maps prediction file names in `<data>/predictions` to the SHA-256 of an earlier attempt's complete
file. Each listed file is reused once its SHA-256 matches. A listed file that is missing or
differs is refused, and so is a listed file the run never uses. The manifest notes name every
reused file. Unlisted files are predicted as usual. Scoring is deterministic, so a reused file is
the file a fresh prediction would write; the seed-206 attempts showed this byte for byte.

A re-score does not score the held-out split (`--skip-heldout` is accepted only there) (it is the re-scored gate's, already reported) and
records `# rescore_of: <experiment>`, each model's digest and the skipped held-out split in its
manifest notes; a later re-score of it is refused. The plan's `dataset.fresh_test.count` makes the
fresh test split the test split of a `count`-scenario dataset (indices 0.9·count to count):
100,000 test scenarios are those of a 1,000,000-scenario seed, generated alone by
`scripts/generate-splits.mjs`, byte-identical to `tma-generate`'s test split and outside the
generator source the G0 guard pins.

## Shuffled-label test

`lstm-instantaneous-shuffled` is the instantaneous model trained with each scenario's targets
swapped for another scenario's (seeded permutation; inputs untouched). With no relation between
bearings and labels left, it should learn the mean and score like the naive baseline (±10%). Doing
much better would mean the inputs leak the answer. The check decides on range error only, as
pre-registered; its detail also reports the shuffled model's median course error beside naive's,
where a weak bearing-as-course prior shows up (iteration 1: 82.9° against a permutation null of
89.7°).
