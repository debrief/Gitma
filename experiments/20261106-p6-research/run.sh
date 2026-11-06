#!/bin/bash
# Spec 018 research (seed-211 validation only): stated sds of the fused tracker and the reference
# IMM (decision 32, -g1, with -sd), post-hoc multipliers, and the two-fold G7 diagnostic.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p7v; P=$D/pred; E=experiments/20261106-p6-research; mkdir -p $P
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1 --report-sd"
# 1. Seed-211 data from a clean tree (digests checked): train-plan.mjs data configs/phase4/f/plan.json $D validation
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $P/imm-g1-sd.ndjson --filter imm $IMM
node packages/models/dist/cli-predict.js --model experiments/20261101-p4b-models/models/tracker \
  --truth $D/validation.f32pack --features $D/validation.features.bin --out $P/t2.ndjson --train $D/train.f32pack
node packages/eval/dist/cli-fuse-track.js --truth $D/validation.f32pack --network $P/t2.ndjson --out $P/fused-g1-sd.ndjson $IMM
node --max-old-space-size=8192 packages/eval/dist/cli-g7.js --truth $D/validation.f32pack \
  --tracker $P/fused-g1-sd.ndjson --reference $P/imm-g1-sd.ndjson --experiment $E/validation
sha256sum $D/validation.f32pack $P/*.ndjson > $E/predictions.sha256
