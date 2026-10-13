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
- `--bootstrap <B>` adds `<dir>/bootstrap.json`: single-median CIs (range, course, speed) for every
  per-timestep estimator on the overall and σ slices at each `--points` point, and paired
  model/naive median range-error ratio CIs (overall). `tma-g2` passes B = 2,000; omitted otherwise
  (G0/G1 outputs unchanged). `--bootstrap-seed` defaults to 20261011 (as G1).
- G2 needs `--points 300,600` (speed is judged at zig + 600 s, SRD §5 as amended 2026-10-11).

## `tma-gate g2` (packages/eval) — new subcommand

```
tma-gate g2 --experiment <dir> --instantaneous <id> --time-late <id>
            --causal-control <id> --mlp-control <id> --shuffled <id>
            [--slice sigma=1deg] [--point zig+300s] [--speed-point zig+600s]
```

Reads `metrics.json`, `curves.csv`, `bootstrap.json`; refuses (exit 2) without naive and classical
per-timestep metrics or without bootstrap CIs. Writes `verdict.json` (`gate: G2`) with checks:
`g2-instantaneous-range`, `g2-instantaneous-course`, `g2-instantaneous-speed`, the same three for
`time-late`, then `g1-instantaneous`, `g1-time-late`, `time-late-not-worse`,
`instantaneous-beats-control`, `time-late-beats-control`, `shuffled-labels-at-naive` (on noisy data).
Exit 3 on fail or inconclusive (as PR #21; plan "Exit codes"). `--point` sets the range and course
point, `--speed-point` the speed point; with `--slice` they exist for the validation diagnostics; the
committed verdict always uses the defaults.

## `tma-g2` (packages/models) — new

```
tma-g2 --data <dir> --models <dir> --experiment <experiments/<id>> [--split test|validation]
       [--compare-models <dir>] [--decision <decision.json>]
```

One-command run, as `tma-g1`: naive (per-timestep), classical (per-timestep, on both splits — the
gate refuses without it and `--compare-to` needs it; PR C), every model's predictions, then the
library equivalent of `tma-eval --points 300,600 --bootstrap 2000 --compare-to
classical:per_timestep` and `tma-gate g2` (both command lines recorded in the manifest).
`--split` defaults to `test`.

- `--split validation` reads only `train.*` and `validation.*`: no test or held-out file is opened
  (tested with them absent). Its checks go to `diagnostic.json`, not `verdict.json`, with
  `decided_by` saying it is a validation diagnostic, so the site's gate status never shows it.
- `--split test` writes `verdict.json`, scores the held-out split into `heldout/`, and refuses
  (exit 2) a dirty tree (`--allow-dirty` as `tma-g1`). When a phase B exists (`configs/iter2/b/`
  present, or `--compare-models` given) it requires `--decision`: a valid `ChangeDecision`,
  tracked by git with no uncommitted change, with `stalled: true` (SC-005).
- `--compare-models` scores the non-carried phase's models into `<experiment>/other-phase/`
  (metrics, bootstrap, comparison, `diagnostic.json`; reported, not gated).
- Each model reads `<split>.<feature_set>.features.bin` if present, else `<split>.features.bin`,
  and refuses a file of another feature set.

Exit codes as `tma-gate g2`.

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

As built (PR C): the plan also has `id` (results branch `results/<id>-<run id>`) and an optional
`continue_from`; `evaluate` may add `decision` and `compare_models` (test split only). Branch
`train/i<N><phase>` selects `configs/iter<N>/<phase>/plan.json`. `digests` are **content digests**:
SHA-256 of each `.f32pack` from its first scenario block to the end (`scripts/train-plan.mjs
digest`), because the header records the generator commit and a whole-file digest could never be
pinned in a committed plan. An iteration-N plan (N ≥ 2) refuses seeds 42 and 101 and ranges files
other than `configs/iter<N>-*`.

Training: matrix over `models`, up to three chained jobs per model (`train-1` → `train-2` →
`train-3`, each ≤ 358 min with a 345-min train step, `.github/workflows/train-model.yml`); each
regenerates and digest-checks the data, restores the checkpoint branch, runs `tma-train --check`
(G0 guard + lineage, even when the model is already complete), then trains or, if complete, does
nothing. Evaluation job: restores the completed models, runs `evaluate` (for a validation plan the
test and held-out files are deleted first) and pushes `results/<id>-<run id>` cut from
`origin/main`. A job fails if regenerated data digests differ from the plan's.

## `tma-train` — `--check` (PR C)

`tma-train --check …` runs the G0 guard, config parse and lineage checks with the same refusals,
then exits 0 without training or writing anything.
