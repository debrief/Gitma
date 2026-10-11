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
pnpm tma-generate -- --seed 1 --count 1000 --out data/s1c --format both
diff -r data/s1 data/s1b
pnpm tma-convert -- --check data/s1c/test.ndjson data/s1c/test.f32pack
```

Expected: generation < 2 min; `diff` silent; `--check` exit 0.

Measured on a clean clone (2026-10-11): 12–14 s per 10^5-scenario generation; `diff` identical.

## 3. G0 run (SC-001, SC-005, SC-006)

```
pnpm tma-generate -- --seed 42 --count 100000 --noise-free --out data/g0
pnpm tma-g0       -- --data data/g0 --experiment experiments/<date>-g0   # always via pnpm: rebuilds first; refuses a dirty tree
```

Expected: `experiments/20261011-g0/verdict.json` → `"result": "pass"`; whole sequence < 15 min
(measured: ~70 s).

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

Measured (2026-10-11, after the per-timestep fix): per-timestep solve ≈ 1 min for 1,000 test
scenarios. Classical median range error at zig+300 s is 0.09 (P90 0.59) against naive 0.38. Before
the fix this run showed P90 ≈ 5×10⁷; see research R5.

## 5. Leakage check on features

```
pnpm vitest run packages/features/test/leakage
```

Expected: normalisation constants identical with labels shuffled.

## 6. Site

```
pnpm site:start
```

Expected: welcome page shows "G0: pass"; data dictionary lists every schema class; algorithm pages for
generator, feature layout, naive baseline and least-squares solver exist.
