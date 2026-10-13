# Quickstart: Iteration 1 → G1 verdict

## 0. Preconditions

- G0 pass committed in `experiments/` (training refuses otherwise).
- `pnpm install && uv sync && pnpm build`

## 1. Data (≈ 1 min) and features (≈ 1 min)

```
pnpm tma-generate --seed 101 --count 100000 --ranges configs/iter1-ranges.json --out data/i1
pnpm tma-features norm  --train data/i1/train.f32pack --out data/i1/norm.json
for s in train validation test heldout; do
  pnpm tma-features build --in data/i1/$s.f32pack --norm data/i1/norm.json --out data/i1/$s.features.bin
done
```

`configs/iter1-ranges.json` = default ranges with σ = 0.5° only and no dropouts.

## 2. Train (≤ 5.5 h each)

On GitHub Actions (preferred; cloud sessions are reclaimed when idle): push any branch named
`train/**` (or run the "Train iteration 1 (G1)" workflow). Five jobs train in parallel, then a G1
job evaluates and pushes `results/g1-<run id>`. Locally:

```
for m in instantaneous time-late causal-cnn mlp instantaneous-shuffled; do
  pnpm tma-train --config configs/iter1/$m.json --train data/i1/train.features.bin \
    --val data/i1/validation.features.bin --out models/i1/$m
done
```

Expected: each `manifest.json` has `stop_reason` ≠ `diverged` and `wall_s` ≤ 19 800.

## 3. Evaluate and judge G1 (≈ 15 min, mostly classical per-timestep)

```
pnpm tma-g1 --data data/i1 --models models/i1 --experiment experiments/<date>-g1
```

Expected: `verdict.json` with gate G1, every check listed with detail; `curves.csv` holds all
estimators.

## 4. Reproducibility

```
pnpm tma-train --config configs/iter1/instantaneous.json --train data/i1/train.features.bin \
  --val data/i1/validation.features.bin --out models/i1/instantaneous-repeat
cmp models/i1/instantaneous/weights.bin models/i1/instantaneous-repeat/weights.bin
```

(Use a reduced config for this check in CI: 512 scenarios, 2 epochs.)

## 5. Site and preview

```
pnpm site:build   # results review page for the latest experiment
```

Open a PR touching `experiments/` or `site/`: the preview link appears as a PR comment.
