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

## Loss

Targets and a per-row weight are packed into `y_true` [240 × 5]. Per row:

`w_r·(Δ log r)² + w_c·(Δ sin² + Δ cos²) + w_s·(Δ speed)²`, averaged over rows with weight > 0.

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
- On GitHub Actions each job pushes its output folder to a `checkpoints/<branch>/<model>` git
  branch after every epoch and restores it at start, so a cancelled or crashed job resumes and a
  completed model is not retrained. Once the G1 results branch is pushed, the run deletes its
  own checkpoint branches and any whose train branch no longer exists.
- Training refuses to start without a passing G0 verdict in `experiments/`.

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
`1000·exp(log_range_km)`, course `atan2(sin, cos)`, speed `speed_scaled × speed_scale_mps`, and
position from range along the last valid bearing (as the naive baseline). Non-finite outputs give
`converged = false`, scored as gross errors.

A model is only run on features normalised exactly as its training data was. The one tolerated
difference is a train-split header that differs only in `schema_version` (a schema bump after
training, same data and constants); `tma-g1` logs it and records it in the experiment manifest, and
`tma-model-predict` accepts it when given `--train <train.f32pack>`.

## Shuffled-label test

`lstm-instantaneous-shuffled` is the instantaneous model trained with each scenario's targets
swapped for another scenario's (seeded permutation; inputs untouched). With no relation between
bearings and labels left, it should learn the mean and score like the naive baseline (±10%). Doing
much better would mean the inputs leak the answer. The check decides on range error only, as
pre-registered; its detail also reports the shuffled model's median course error beside naive's,
where a weak bearing-as-course prior shows up (iteration 1: 82.9° against a permutation null of
89.7°).
