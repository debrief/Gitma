#!/bin/bash
# Phase 7 validation (spec 019, SRD Annex C §C.14): the frozen -g1 fused tracker against the frozen
# -g1 IMM on seed 217's validation split with realistic bearing error (configs/phase7-ranges.json),
# by tma-g5 as a diagnostic; the same rows regenerated with the phase-4 ranges ("clean") for the
# pre-registered clean comparison (scripts/research/spec019-clean.mjs, committed at 4925b73 first).
# T2 keeps seed 211's normalisation (its train split, phase-4 ranges). Data are regenerable, not
# committed; SHA-256s in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p7val; E=experiments/20261108-p7-val
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. Data at a clean commit: seed 211's train split (normalisation), and seed 217's validation split
#    twice, with the phase-7 and the phase-4 ranges.
node scripts/generate-splits.mjs --seed 211 --count 100000 --ranges configs/phase4-ranges.json \
  --heldout-ranges configs/phase4-heldout-ranges.json --out $D/s211 --splits train
for v in real:phase7 clean:phase4; do
  node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/${v#*:}-ranges.json \
    --heldout-ranges configs/${v#*:}-heldout-ranges.json --out $D/${v%%:*} --splits validation
done
node packages/features/dist/cli.js norm --train $D/s211/train.f32pack --feature-set derived --out $D/norm.json
# 2. Per variant: features, the -g1 IMM and EKF, frozen T2, and the -g1 fused tracker (k 4, every 6).
for v in real clean; do
  V=$D/$v; mkdir -p $V/pred
  node packages/features/dist/cli.js build --in $V/validation.f32pack --norm $D/norm.json \
    --feature-set derived --out $V/validation.features.bin
  node packages/classical/dist/cli-track.js --in $V/validation.f32pack --out $V/pred/imm.ndjson --filter imm $IMM &
  node packages/classical/dist/cli-track.js --in $V/validation.f32pack --out $V/pred/ekf.ndjson --filter ekf \
    --sigma-a 0.03 --p0-scale 4 --r-scale 8 --guarded-init 1 &
  node packages/models/dist/cli-predict.js --model $T2 --truth $V/validation.f32pack \
    --features $V/validation.features.bin --out $V/pred/t2.ndjson --train $D/s211/train.f32pack &
  wait
  node packages/eval/dist/cli-fuse-track.js --truth $V/validation.f32pack --network $V/pred/t2.ndjson \
    --out $V/pred/fused.ndjson $IMM
done
# 3. The G5 diagnostic on the realistic split (the fused tracker, carried by decision 31; the EKF
#    reported), each against the IMM; and on the clean split for reference.
for v in real clean; do
  node packages/eval/dist/cli-g5.js --truth $D/$v/validation.f32pack --tracker $D/$v/pred/fused.ndjson \
    --tracker $D/$v/pred/ekf.ndjson --reference $D/$v/pred/imm.ndjson --experiment $E/g5-$v
done
# 4. The clean comparison (reported), fused and EKF against the IMM.
node scripts/research/spec019-clean.mjs $D/real/validation.f32pack $D/clean/validation.f32pack \
  $D/real/pred/fused.ndjson $D/real/pred/imm.ndjson $D/clean/pred/fused.ndjson $D/clean/pred/imm.ndjson > $E/clean.json
node scripts/research/spec019-clean.mjs $D/real/validation.f32pack $D/clean/validation.f32pack \
  $D/real/pred/ekf.ndjson $D/real/pred/imm.ndjson $D/clean/pred/ekf.ndjson $D/clean/pred/imm.ndjson > $E/clean-ekf.json
( cd $D && sha256sum s211/train.f32pack norm.json */validation.f32pack */pred/*.ndjson ) > $E/predictions.sha256
