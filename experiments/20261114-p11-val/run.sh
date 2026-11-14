#!/bin/bash
# Phase 11 validation (spec 023 T003, SRD Annex C §C.18): the retrained T2 (lstm-gaussian-re, model
# experiments/20261113-p11a-models) against the frozen -g1 IMM, beating the frozen T2 on range: a
# tma-g5 --beat diagnostic on seed 217's validation split with realistic bearing error. Carry rule:
# all six point estimates within their limits. Committed before scoring; data regenerable, not
# committed (hashes in predictions.sha256).
# Each T2 keeps its own normalisation: the frozen T2 seed 211's train split (phase-4 ranges), the
# retrained T2 seed 226's (phase-7 ranges). Reported, not gated: the clean twin (seed 217 with the
# phase-4 ranges), the fused tracker and the phase-10 hybrid rebuilt on the retrained T2, the EKF,
# batch least squares and naive.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p11val; E=experiments/20261114-p11-val
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
RE=experiments/20261113-p11a-models/models/tracker
# 1. Data at a clean commit.
node scripts/generate-splits.mjs --seed 211 --count 100000 --ranges configs/phase4-ranges.json \
  --heldout-ranges configs/phase4-heldout-ranges.json --out $D/s211 --splits train
node scripts/generate-splits.mjs --seed 226 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D/s226 --splits train
for v in real:phase7 clean:phase4; do
  node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/${v#*:}-ranges.json \
    --heldout-ranges configs/${v#*:}-heldout-ranges.json --out $D/${v%%:*} --splits validation
done
for s in 211 226; do
  node packages/features/dist/cli.js norm --train $D/s$s/train.f32pack --feature-set derived --out $D/norm$s.json
done
# 2. Per variant: features under each normalisation, the -g1 IMM and EKF, both T2s, and the fused
#    tracker and hybrid on each T2.
for v in real clean; do
  V=$D/$v; mkdir -p $V/pred
  for s in 211 226; do
    node packages/features/dist/cli.js build --in $V/validation.f32pack --norm $D/norm$s.json \
      --feature-set derived --out $V/validation.features$s.bin
  done
  node packages/classical/dist/cli-track.js --in $V/validation.f32pack --out $V/pred/imm.ndjson --filter imm $IMM &
  node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $V/validation.f32pack \
    --out $V/pred/naive.ndjson --per-timestep &
  node packages/classical/dist/cli-track.js --in $V/validation.f32pack --out $V/pred/ekf.ndjson --filter ekf \
    --sigma-a 0.03 --p0-scale 4 --r-scale 8 --guarded-init 1 &
  node packages/models/dist/cli-predict.js --model $T2 --truth $V/validation.f32pack \
    --features $V/validation.features211.bin --out $V/pred/t2.ndjson --train $D/s211/train.f32pack &
  node packages/models/dist/cli-predict.js --model $RE --truth $V/validation.f32pack \
    --features $V/validation.features226.bin --out $V/pred/t2re.ndjson --train $D/s226/train.f32pack &
  wait
  for n in t2 t2re; do
    node packages/eval/dist/cli-fuse-track.js --truth $V/validation.f32pack --network $V/pred/$n.ndjson \
      --out $V/pred/fused-$n.ndjson $IMM
    node packages/eval/dist/cli-hybrid-track.js --truth $V/validation.f32pack --tracker $V/pred/fused-$n.ndjson \
      --network $V/pred/$n.ndjson --out $V/pred/hybrid-$n.ndjson --course-deg 180
  done
done
# 3. The diagnostic: the retrained T2 against the IMM, beating the frozen T2 (realistic split).
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/real/validation.f32pack \
  --tracker $D/real/pred/t2re.ndjson --reference $D/real/pred/imm.ndjson --beat $D/real/pred/t2.ndjson \
  --also $D/real/pred/ekf.ndjson --experiment $E/g8
# 4. Reported: baselines on the realistic split, batch least squares, and the clean twin.
node --max-old-space-size=8192 scripts/research/spec019-baselines.mjs $D/real/validation.f32pack $E/baselines.json \
  $D/real/pred/t2re.ndjson $D/real/pred/t2.ndjson $D/real/pred/imm.ndjson $D/real/pred/ekf.ndjson \
  $D/real/pred/fused-t2re.ndjson $D/real/pred/fused-t2.ndjson $D/real/pred/hybrid-t2re.ndjson $D/real/pred/hybrid-t2.ndjson \
  $D/real/pred/naive.ndjson
node --max-old-space-size=8192 scripts/research/spec014-lsq.mjs $D/real/validation.f32pack $E/lsq.json
node --max-old-space-size=8192 scripts/research/spec019-baselines.mjs $D/clean/validation.f32pack $E/baselines-clean.json \
  $D/clean/pred/t2re.ndjson $D/clean/pred/t2.ndjson $D/clean/pred/imm.ndjson $D/clean/pred/ekf.ndjson
node scripts/research/spec019-clean.mjs $D/real/validation.f32pack $D/clean/validation.f32pack \
  $D/real/pred/t2re.ndjson $D/real/pred/t2.ndjson $D/clean/pred/t2re.ndjson $D/clean/pred/t2.ndjson > $E/clean.json
( cd $D && sha256sum s211/train.f32pack s226/train.f32pack norm*.json */validation.f32pack */pred/*.ndjson ) \
  > $E/predictions.sha256
