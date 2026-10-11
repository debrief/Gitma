# Quickstart: Iteration 0 → G0 verdict

Validation guide proving the feature end-to-end. Command details: [contracts/cli.md](contracts/cli.md).

## Prerequisites

- Node 22 (see `.nvmrc`), pnpm 9+, uv.
- `pnpm install && pnpm build`

## 1. Repo checks (SC-007)

```
pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check && pnpm site:build
```

Expected: all pass; `schema:check` fails if `packages/types/` is stale.

## 2. Generator throughput and determinism (SC-002, SC-003, SC-004)

```
time pnpm tma-generate -- --seed 1 --count 100000 --out data/s1
pnpm tma-generate -- --seed 1 --count 100000 --out data/s1b
diff -r data/s1 data/s1b
pnpm tma-convert -- --check data/s1/test.ndjson data/s1/test.f32pack
```

Expected: generation < 2 min; `diff` silent; `--check` exit 0.

## 3. G0 run (SC-001, SC-005, SC-006)

```
pnpm tma-generate -- --seed 42 --count 100000 --noise-free --out data/g0
pnpm tma-solve    -- --in data/g0/test.f32pack --out data/g0/classical.ndjson
pnpm tma-naive    -- fit --train data/g0/train.f32pack --out data/g0/naive.json
pnpm tma-naive    -- predict --model data/g0/naive.json --in data/g0/test.f32pack --out data/g0/naive.ndjson
pnpm tma-g0       -- --data data/g0 --experiment experiments/20261011-g0
```

`tma-g0` is a workspace script that runs `tma-eval` twice for the naive baseline and then `tma-gate g0`.
Expected: `experiments/20261011-g0/verdict.json` → `"result": "pass"`; whole sequence < 15 min.

## 4. Noisy sanity run

```
pnpm tma-generate -- --seed 7 --count 10000 --out data/n1
pnpm tma-solve -- --in data/n1/test.f32pack --out data/n1/classical.ndjson --per-timestep
pnpm tma-naive -- fit --train data/n1/train.f32pack --out data/n1/naive.json
pnpm tma-naive -- predict --model data/n1/naive.json --in data/n1/test.f32pack --out data/n1/naive.ndjson --per-timestep
pnpm tma-eval  -- --truth data/n1/test.f32pack --pred data/n1/classical.ndjson data/n1/naive.ndjson \
                  --experiment experiments/20261011-noisy-sanity
```

Expected: classical errors grow with σ; classical beats naive on median range error in every σ slice;
`curves.csv` shows error falling with time since zig.

## 5. Leakage check on features

```
pnpm --filter @tma/features test -- leakage
```

Expected: normalisation constants identical with labels shuffled.

## 6. Site

```
pnpm site:start
```

Expected: welcome page shows "G0: pass"; data dictionary lists every schema class; algorithm pages for
generator, feature layout, naive baseline and least-squares solver exist.
