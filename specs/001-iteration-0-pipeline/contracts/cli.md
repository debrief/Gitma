# Contract: Stage CLIs

Each stage is a separate command reading and writing files (constitution III). All commands:

- run as `pnpm <cmd> -- [options]` from the repo root (workspace scripts wrap `node packages/<pkg>/dist/cli.js`);
- validate every input file against generated schemas and exit non-zero with `file:record: message` on failure;
- write outputs atomically (temp file + rename);
- print a one-line JSON summary to stdout; logs to stderr;
- exit codes: `0` ok, `1` usage error, `2` validation/version error, `3` gate failed (`tma-gate` only).

## `tma-generate` (packages/data)

```
tma-generate --seed <uint64> --count <n> --out <dir>
             [--ranges <ranges.json>] [--noise-free] [--heldout-ranges <ranges.json>]
             [--format ndjson|f32pack|both]   (default f32pack)
```

Writes `<dir>/{train,validation,test,heldout}.{ndjson,f32pack}`. Splits are 80/10/10 of `count` by
scenario index; `heldout` has `count/10` scenarios from `--heldout-ranges` (default: SRD example,
range 20–30 km). `--noise-free` forces σ = 0 and no dropouts.

Default format is `f32pack` because NDJSON is ~7× larger (10^5 scenarios ≈ 3.8 GB NDJSON vs
≈ 0.6 GB pack); use `--format both` or `tma-convert` when a split needs inspecting. The header's
`created_by` records only generation-relevant arguments, so output bytes do not depend on `--out` or
`--format`.

## `tma-convert` (packages/data)

```
tma-convert --in <file.ndjson|file.f32pack> --out <file.f32pack|file.ndjson>
```

Lossless conversion. `tma-convert --check <a> <b>` exits 0 iff both hold identical scenarios.

## `tma-features` (packages/features)

```
tma-features norm  --train <train.f32pack> --out <norm.json>
tma-features build --in <split.f32pack> --norm <norm.json> --out <split.features.bin>
```

`norm` reads input channels only. `build` writes inputs, targets and masks per
[data-model FeatureLayout](../data-model.md#featurelayout-documentation-of-tensor-shapes-tensors-themselves-are-not-stored-as-linkml-records).

## `tma-naive` (packages/classical)

```
tma-naive fit     --train <train.f32pack> --out <naive.json>
tma-naive predict --model <naive.json> --in <test.f32pack> --out <pred.ndjson> [--per-timestep]
```

## `tma-solve` (packages/classical)

```
tma-solve --in <test.f32pack> --out <pred.ndjson> [--per-timestep] [--max-iter 50]
```

Per-timestep mode emits one row per post-zig timestep using bearings up to that time.

## `tma-eval` (packages/eval)

```
tma-eval --truth <test.f32pack> --pred <pred.ndjson>... --experiment <experiments/<id>>
         [--points final,zig+300] [--curve-step 60]
```

Writes `metrics.csv`, `metrics.json`, `curves.csv` (per-timestep predictions only) and updates
`manifest.json`. Refuses to write a report unless `naive` and `classical` predictions for the same test
set are among the inputs (FR-019).

## `tma-gate` (packages/eval)

```
tma-gate g0 --experiment <experiments/<id>> --noise-free-pred <pred.ndjson> --truth <test.f32pack>
            --naive-a <metrics.json> --naive-b <metrics.json>
```

Writes `verdict.json`; exit 0 on pass, 3 on fail. Checks: (1) classical recovers noise-free truth within
SC-001 tolerance on 100% of scenarios; (2) two independent naive runs produce identical metrics.

## `tma-g0` (workspace script, `scripts/g0.ts`)

```
tma-g0 --data <dir> --experiment <experiments/<id>>
```

Convenience wrapper for quickstart §3: expects `<dir>/{test.f32pack,classical.ndjson,naive.ndjson}`;
runs `tma-eval` twice for the naive baseline (to check reproducibility), once for classical, then
`tma-gate g0`. Exit code is `tma-gate`'s.
