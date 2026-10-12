# Quickstart: Iteration 2 → G2 verdict

## 0. Preconditions

- G1 `pass` decided by the agent review panel (`experiments/<date>-g1/review.md`).
- G0 re-run after PR A (provenance, and the rate-limited turn if confirmed) passed and was approved
  by the panel: `experiments/<date>-g0-i2/`. Training refuses otherwise.
- Clean working tree (generation refuses a dirty tree), then
  `pnpm install && uv sync && pnpm build`.

## 1. G0 re-run after PR A (≈ 10 min)

```
pnpm tma-generate --seed 42 --count 100000 --noise-free --out data/g0-i2
pnpm tma-g0 --data data/g0-i2 --experiment experiments/<date>-g0-i2
```

Expected: `verdict.json` G0 `pass` including the in-turn `independent-geometry` case (US6); then the
panel reviews and `decided_by` names the final round.

## 2. Data and features (≈ 3 min)

```
pnpm tma-generate --seed 201 --count 100000 --ranges configs/iter2-ranges.json \
  --heldout-ranges configs/iter2-heldout-ranges.json --out data/i2
head -c 2000 data/i2/train.ndjson | grep -o '"generator_git_commit":"[0-9a-f]*"'
for fs in raw derived; do
  pnpm tma-features norm --train data/i2/train.f32pack --feature-set $fs --out data/i2/norm-$fs.json
  for s in train validation test heldout; do
    pnpm tma-features build --in data/i2/$s.f32pack --norm data/i2/norm-$fs.json \
      --feature-set $fs --out data/i2/$s.$fs.features.bin
  done
done
sha256sum data/i2/*.f32pack   # must match configs/iter2/a/plan.json
```

## 3. Achievability reference (before training; ≈ 15 min)

```
pnpm tma-naive fit --train data/i2/train.f32pack --out data/i2/naive.json
pnpm tma-naive predict --model data/i2/naive.json --in data/i2/test.f32pack --per-timestep \
  --out data/i2/predictions/naive.ndjson
pnpm tma-solve --in data/i2/test.f32pack --per-timestep --out data/i2/predictions/classical.ndjson
pnpm tma-eval --truth data/i2/test.f32pack --pred data/i2/predictions/naive.ndjson \
  --pred data/i2/predictions/classical.ndjson --experiment data/i2/achievability
```

(Uses data generated from the pre-PR-A generator if run before PR A merges; the turn changes the
figures slightly, so repeat after PR A if US6 is accepted.)

Read classical `range_rel_median`, `course_deg_median`, `speed_kt_median` on `sigma=1deg` at
`zig+300s` and record them in research R12 before starting training.

## 4. Phase A — train on GitHub Actions (≤ 6 h, parallel)

```
git switch -c train/i2a && git push origin train/i2a      # plan: configs/iter2/a/plan.json
```

The workflow trains five models, runs `tma-g2 --split validation`, and pushes
`results/iter2-a-<run id>`. Locally (development only):

```
pnpm tma-train --config configs/iter2/a/instantaneous.json --train data/i2/train.raw.features.bin \
  --val data/i2/validation.raw.features.bin --out models/i2a/instantaneous
```

Expected refusal on old data: `pnpm tma-train` with iteration-1 features exits 2 with
`lineage-missing`.

## 5. Decision record, then phase B (only if A stalls)

Write `experiments/<date>-i2a-val/decision.{md,json}` (change, evidence from validation only,
carried-set rule), commit and push it, then push `train/i2b` (plan `configs/iter2/b/plan.json`,
`feature_set: derived`).

## 6. G2 on test (CI evaluation job or locally, ≈ 30 min)

```
pnpm tma-g2 --data data/i2 --models models/i2<carried> --compare-models models/i2<other> \
  --decision experiments/<date>-i2a-val/decision.json --split test --experiment experiments/<date>-g2
```

Expected: `verdict.json` gate G2 with six `g2-*` checks (value, threshold, CI) and the repeated
iteration-1 checks; `comparison.csv`; `bootstrap.json`; `heldout/`; exit 0, 3 or 4.

## 7. Panel and site

Run the five-reviewer panel on `experiments/<date>-g2/`; commit `review.md`; then:

```
pnpm site:build   # results page for iteration 2, welcome-page G2 status
```
