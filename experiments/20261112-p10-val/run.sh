#!/bin/bash
# Phase 10 validation (spec 022, SRD Annex C §C.17): the hybrid of T2's range with the frozen fused
# tracker's velocity (θ 180) against the frozen -g1 IMM, beating the fused tracker on range: a
# tma-g5 --beat diagnostic on seed 217's validation split with realistic bearing error. Committed
# before scoring; data regenerable, not committed (hashes in predictions.sha256).
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p10val; E=experiments/20261112-p10-val
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
node scripts/generate-splits.mjs --seed 211 --count 100000 --ranges configs/phase4-ranges.json \
  --heldout-ranges configs/phase4-heldout-ranges.json --out $D/s211 --splits train
node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D --splits validation
node packages/features/dist/cli.js norm --train $D/s211/train.f32pack --feature-set derived --out $D/norm.json
node packages/features/dist/cli.js build --in $D/validation.f32pack --norm $D/norm.json \
  --feature-set derived --out $D/validation.features.bin
mkdir -p $D/pred
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $D/pred/imm.ndjson --filter imm $IMM &
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $D/pred/ekf.ndjson --filter ekf \
  --sigma-a 0.03 --p0-scale 4 --r-scale 8 --guarded-init 1 &
node packages/models/dist/cli-predict.js --model $T2 --truth $D/validation.f32pack \
  --features $D/validation.features.bin --out $D/pred/t2.ndjson --train $D/s211/train.f32pack
wait
node packages/eval/dist/cli-fuse-track.js --truth $D/validation.f32pack --network $D/pred/t2.ndjson \
  --out $D/pred/fused.ndjson $IMM
node packages/eval/dist/cli-hybrid-track.js --truth $D/validation.f32pack --tracker $D/pred/fused.ndjson \
  --network $D/pred/t2.ndjson --out $D/pred/hybrid.ndjson --course-deg 180
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/validation.f32pack \
  --tracker $D/pred/hybrid.ndjson --reference $D/pred/imm.ndjson --beat $D/pred/fused.ndjson \
  --also $D/pred/t2.ndjson --also $D/pred/ekf.ndjson --experiment $E/g8
node --max-old-space-size=8192 scripts/research/spec019-baselines.mjs $D/validation.f32pack $E/baselines.json \
  $D/pred/hybrid.ndjson $D/pred/imm.ndjson $D/pred/fused.ndjson $D/pred/t2.ndjson $D/pred/ekf.ndjson
( cd $D && sha256sum s211/train.f32pack validation.f32pack pred/*.ndjson ) > $E/predictions.sha256
