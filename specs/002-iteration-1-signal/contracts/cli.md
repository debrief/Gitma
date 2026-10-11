# Contract: Iteration-1 CLIs

Same conventions as spec 001 (`contracts/cli.md`): JSON summary on stdout, exit codes 0/1/2, 3 for a
failed gate, atomic writes, validated inputs.

## `tma-train` (packages/models)

```
tma-train --config <training-config.json> --train <train.features.bin> --val <validation.features.bin>
          --out <dir> [--experiments experiments]
```

Refuses to start (exit 2) unless `experiments/*/verdict.json` contains a G0 `pass`. Writes
`<dir>/model.json`, `<dir>/weights.bin` (tfjs layers format) and `<dir>/manifest.json`
(`ModelManifest`). Logs one line per epoch to stderr. On NaN loss: stops, writes the manifest with
`stop_reason: diverged`, exits 2.

## `tma-model-predict` (packages/models)

```
tma-model-predict --model <dir> --truth <test.f32pack> --features <test.features.bin> --out <pred.ndjson>
```

Writes per-timestep predictions (rows from `zig_index + 1`), estimator name = manifest `id`, header
digest bound to the truth file. Truth is read only for ownship positions and bearings needed to
derive position (never target truth).

## `tma-gate g1` (packages/eval)

```
tma-gate g1 --experiment <dir>
            --instantaneous <id> --time-late <id> --causal-control <id> --mlp-control <id>
            [--shuffled <id>]
```

Reads `<dir>/metrics.json` and `<dir>/curves.csv` written by `tma-eval` (which must include naive
and classical per-timestep predictions; refuses otherwise, FR-019) and writes `verdict.json` with gate `G1` and checks:
`g1-instantaneous`, `g1-time-late`, `time-late-not-worse`, `instantaneous-beats-control`,
`time-late-beats-control`, `shuffled-labels-at-naive` (when `--shuffled` is given).

## `tma-g1` (packages/models)

Lives in `packages/models` (not `eval`, as first planned) so tfjs-node stays out of the evaluation
package; the gate logic itself is `@tma/eval`'s `g1Checks`.

```
tma-g1 --data <dir> --models <dir> --experiment <experiments/<id>>
```

One-command run for quickstart: expects `<dir>/{train,test}.f32pack`, `<dir>/*.features.bin`,
`<dir>/norm.json` and trained models under `--models`; runs naive (per-timestep), classical
(per-timestep), every model's predictions, `tma-eval` and `tma-gate g1`, then copies model manifests
and weights into the experiment folder.

Models are found under `--models` by `model_kind` (exactly one each of `instantaneous`,
`time_late`, `causal_cnn`, `mlp`, plus at most one `instantaneous` with `shuffle_labels`); other
configurations tried for FR-009 must sit outside that directory. Prediction files go to
`<data>/predictions/` (too large to commit); the classical per-timestep file there is reused on a
re-run. Experiment layout: `metrics.{json,csv}`, `curves.csv`, `verdict.json`, `manifest.json`,
`seeds.txt`, `heldout/` (FR-014, reported not gated) and `models/<id>/{manifest.json,model.json,weights.bin}`.
Exit 3 when the gate fails.
