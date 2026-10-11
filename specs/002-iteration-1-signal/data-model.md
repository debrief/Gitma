# Data Model: Iteration 1

Additions to `schema/tma.yaml` (version 0.2.0 → 0.3.0, additive). Existing classes are unchanged.

## ModelKind (enum)

`instantaneous`, `time_late`, `causal_cnn`, `mlp`.

## TrainingConfig

| Slot | Type | Notes |
| --- | --- | --- |
| `model_kind` | ModelKind | |
| `units` | integer | LSTM units (per direction for BiLSTM) or conv filters / dense width |
| `kernel_size` | integer? | CNN only |
| `learning_rate` | float | Adam |
| `batch_size` | integer | default 256 |
| `max_epochs` | integer | |
| `patience` | integer | early-stopping epochs without validation improvement |
| `max_wall_s` | float | wall-clock cap (default 21 600) |
| `loss_weight_range`, `loss_weight_course`, `loss_weight_speed` | float | |
| `train_seed` | string | uint64 decimal; derives initializer seeds and batch order |
| `shuffle_labels` | boolean | leakage run only |

## EpochRecord

`epoch`, `train_loss`, `val_loss`, `seconds` (cumulative wall time).

## ModelManifest

| Slot | Type |
| --- | --- |
| `id` | string (estimator name, e.g. `lstm-instantaneous`) |
| `config` | TrainingConfig |
| `schema_version`, `generator_version` | string |
| `train_features_digest`, `val_features_digest` | string (SHA-256) |
| `normalisation` | NormalisationConstants |
| `epochs` | EpochRecord[] |
| `best_epoch` | integer |
| `stop_reason` | `max_epochs` \| `early_stopping` \| `wall_clock` \| `diverged` |
| `wall_s` | float |
| `parameter_count` | integer |
| `tfjs_node_version`, `node_version`, `cpu_model` | string |
| `weights_digest` | string (SHA-256 of saved weights) |
| `model_path` | string (relative, tfjs layers format) |

## Reused

- `Prediction`, `PredictionRow`, `PredictionHeader`: model predictions use them unchanged
  (`estimator` = model id, `mode = per_timestep`).
- `GateVerdict` with `gate: G1`, `GateCheck` for each check.
- `ExperimentManifest.estimators[].settings_json` holds each model's manifest path and digest.
