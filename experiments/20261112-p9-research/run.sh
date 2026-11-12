#!/bin/bash
# Phase 9 research (spec 021, SRD Annex C §C.16): the 18-variant bias-state IMM grid on seed 217's
# validation split with realistic bearing error, and the pre-registered selection
# (scripts/research/spec021-grid.mjs, committed with this file before any variant was scored).
# Data are regenerable, not committed; hashes in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p9val; E=experiments/20261112-p9-research
BASE="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. Data (clean tree): seed 211's train split (T2's normalisation); seed 217's validation split
#    with the phase-7 ranges; T2's derived features; the frozen -g1 IMM and T2.
node scripts/generate-splits.mjs --seed 211 --count 100000 --ranges configs/phase4-ranges.json \
  --heldout-ranges configs/phase4-heldout-ranges.json --out $D/s211 --splits train
node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D --splits validation
node packages/features/dist/cli.js norm --train $D/s211/train.f32pack --feature-set derived --out $D/norm.json
node packages/features/dist/cli.js build --in $D/validation.f32pack --norm $D/norm.json \
  --feature-set derived --out $D/validation.features.bin
mkdir -p $D/pred
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $D/pred/imm.ndjson \
  --filter imm $BASE --r-scale 8 &
node packages/models/dist/cli-predict.js --model $T2 --truth $D/validation.f32pack \
  --features $D/validation.features.bin --out $D/pred/t2.ndjson --train $D/s211/train.f32pack
wait
# 2. The grid: bias sd {0.25, 0.5, 1} deg x tau {600, 1200, 2400} s x r {4, 8}, four at a time.
for sd in 0.25 0.5 1; do
  for tb in 600 1200 2400; do
    for r in 4 8; do
      node packages/classical/dist/cli-track.js --in $D/validation.f32pack \
        --out $D/pred/bias-b$sd-tb$tb-r$r.ndjson --filter imm $BASE --r-scale $r \
        --bias-sd $sd --bias-tau $tb > /dev/null &
      while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
    done
  done
done
wait
# 3. The selection.
node --max-old-space-size=12288 scripts/research/spec021-grid.mjs $D/validation.f32pack \
  $D/pred/imm.ndjson $D/pred/t2.ndjson $D/pred/bias-*.ndjson > $E/grid.json
( cd $D && sha256sum s211/train.f32pack validation.f32pack pred/*.ndjson ) > $E/predictions.sha256
