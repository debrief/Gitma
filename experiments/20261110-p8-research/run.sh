#!/bin/bash
# Phase 8 research (spec 020, SRD Annex C §C.15): the 24-variant fusion grid on seed 217's validation
# split with realistic bearing error, and the pre-registered selection (scripts/research/spec020-grid.mjs,
# committed at 14eeb1a before any variant was scored). Data are regenerable, not committed.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p8val; E=experiments/20261110-p8-research
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. Data (clean tree): seed 211's train split (T2's normalisation), seed 217's validation split
#    with the phase-7 ranges; T2's derived features; the -g1 IMM and frozen T2.
node scripts/generate-splits.mjs --seed 211 --count 100000 --ranges configs/phase4-ranges.json \
  --heldout-ranges configs/phase4-heldout-ranges.json --out $D/s211 --splits train
node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D --splits validation
node packages/features/dist/cli.js norm --train $D/s211/train.f32pack --feature-set derived --out $D/norm.json
node packages/features/dist/cli.js build --in $D/validation.f32pack --norm $D/norm.json \
  --feature-set derived --out $D/validation.features.bin
mkdir -p $D/pred
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $D/pred/imm.ndjson --filter imm $IMM &
node packages/models/dist/cli-predict.js --model $T2 --truth $D/validation.f32pack \
  --features $D/validation.features.bin --out $D/pred/t2.ndjson --train $D/s211/train.f32pack
wait
# 2. The grid: k in {0.5, 1, 1.5, 2, 3, 4} x M in {1, 3, 6, 12}, four at a time.
for k in 0.5 1 1.5 2 3 4; do
  for m in 1 3 6 12; do
    node packages/eval/dist/cli-fuse-track.js --truth $D/validation.f32pack --network $D/pred/t2.ndjson \
      --out $D/pred/fused-k$k-m$m.ndjson $IMM --k $k --every $m > /dev/null &
    while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
  done
done
wait
# 3. The selection.
node --max-old-space-size=12288 scripts/research/spec020-grid.mjs $D/validation.f32pack \
  $D/pred/imm.ndjson $D/pred/t2.ndjson $D/pred/fused-k*.ndjson > $E/grid.json
( cd $D && sha256sum s211/train.f32pack validation.f32pack pred/*.ndjson ) > $E/predictions.sha256
