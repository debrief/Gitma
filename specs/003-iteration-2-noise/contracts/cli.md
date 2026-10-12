# Contract: Iteration-2 CLI changes

Same conventions as specs 001/002: JSON summary on stdout, exit 0 success, 1 usage, 2 refused or
invalid input, 3 failed or inconclusive gate (as PR #21; `verdict.json` tells them apart). Atomic writes; every input
validated with the generated validators.

## `tma-generate` (packages/data) — changed

```
tma-generate --seed <u64> --count <n> [--ranges <json>] [--heldout-ranges <json>]
             [--noise-free] [--allow-dirty] --out <dir>
```

- Header records `generator_git_commit` and `generator_git_dirty` (git run in the package checkout).
- Refuses (exit 2) when the tree is dirty, unless `--allow-dirty`; outside a git checkout, refuses
  unless `--allow-dirty` (then commit = `"unknown"`, dirty = `true`).
- Ranges may include `ownship_turn_rate_rad_s` (US6); absent = instantaneous zig.

## `tma-features` (packages/features) — changed

```
tma-features norm  --train <train.f32pack> [--feature-set raw|derived] --out <norm.json>
tma-features build --in <split.f32pack> --norm <norm.json> [--feature-set raw|derived] --out <x.features.bin>
```

- Writes format version 2: source `DatasetHeader` and dataset digest embedded; layout names
  `feature_set`. `--feature-set` defaults to `raw`.
- `norm --feature-set derived` adds `bearing_rate_scale_rad_s` (inputs only).
- `build` refuses a norm file lacking the constants its feature set needs.

## `tma-train` (packages/models) — changed

Same arguments as spec 002. Additional refusals (exit 2), each with a named reason:

- `lineage-missing`: train or validation features lack a source header with provenance (format v1
  or pre-0.5.0 data).
- `lineage-dirty`: source header has `generator_git_dirty: true`.
- `lineage-mismatch`: `GENERATOR_PATHS` differ between the accepted G0 commit and the header's
  `generator_git_commit` (or that commit is not in history).
- `lineage-split-mismatch`: train and validation features come from different datasets (seed or
  commit differ).
- `feature-set-mismatch`: config `feature_set` ≠ features file `feature_set`.

The manifest records `source_dataset_header` and `g0_experiment`.

## `tma-eval` (packages/eval) — changed

```
tma-eval --truth <split> --pred <file> [--pred <file>...] --experiment <dir> [--points 300]
         [--curve-step 60] [--bootstrap <B>] [--bootstrap-seed <u64>] [--compare-to <estimator label>]
```

- Adds `dropout_band` slices, `position_window_m_{median,p90}`, and, with `--compare-to`, writes
  `comparison.{csv,json}` (`PairedComparison`, common rows only).
- `--bootstrap` adds `<dir>/bootstrap.json`: CIs for overall and σ slices at gate points. Default
  B = 2,000 when given without a value in `tma-g2`; omitted otherwise (G0/G1 outputs unchanged).

## `tma-gate g2` (packages/eval) — new subcommand

```
tma-gate g2 --experiment <dir> --instantaneous <id> --time-late <id>
            --causal-control <id> --mlp-control <id> --shuffled <id>
            [--slice sigma=1deg] [--point zig+300s]
```

Reads `metrics.json`, `curves.csv`, `bootstrap.json`; refuses (exit 2) without naive and classical
per-timestep metrics or without bootstrap CIs. Writes `verdict.json` (`gate: G2`) with checks:
`g2-instantaneous-range`, `g2-instantaneous-course`, `g2-instantaneous-speed`, the same three for
`time-late`, then `g1-instantaneous`, `g1-time-late`, `time-late-not-worse`,
`instantaneous-beats-control`, `time-late-beats-control`, `shuffled-labels-at-naive` (on noisy data).
Exit 3 on fail, 4 on inconclusive. `--slice`/`--point` exist for the validation diagnostics; the
committed verdict always uses the defaults.

## `tma-g2` (packages/models) — new

```
tma-g2 --data <dir> --models <dir> --experiment <experiments/<id>> [--split test|validation]
       [--compare-models <dir>] [--decision <decision.json>]
```

One-command run, as `tma-g1`: naive (per-timestep), classical (per-timestep; skipped for
`--split validation`), every model's predictions, `tma-eval --bootstrap --compare-to
classical:per_timestep`, `tma-gate g2`. `--compare-models` scores the non-carried phase's models
into `<experiment>/other-phase/` (reported, not gated). `--split test` requires `--decision` naming a
committed decision record (SC-005) when a phase-B directory exists. Held-out split scored into
`heldout/`. Exit codes as `tma-gate g2`.

## `tma-g0` (packages/eval) — changed (US6)

`independent-geometry` gains an in-turn case: a hand-computed bearing at a sample half-way through a
known turn, using literal `Math.atan2` and the closed-form arc. Other checks unchanged.

## Workflow: `.github/workflows/train.yml` — generalised

Trigger: push to `train/**` or `workflow_dispatch` with input `plan`. Reads
`configs/<plan>/plan.json`:

```json
{
  "dataset": { "seed": "201", "count": 100000, "ranges": "configs/iter2-ranges.json",
               "heldout_ranges": "configs/iter2-heldout-ranges.json", "digests": { "train.f32pack": "…" } },
  "feature_set": "raw",
  "models": ["instantaneous", "time-late", "causal-cnn", "mlp", "instantaneous-shuffled"],
  "configs": "configs/iter2/a",
  "evaluate": { "command": "tma-g2", "split": "validation" }
}
```

Training jobs: matrix over `models`, ≤ 358 min each. Evaluation job: runs `evaluate`, pushes
`results/<plan>-<run id>`. A job fails if regenerated data digests differ from the plan's.
