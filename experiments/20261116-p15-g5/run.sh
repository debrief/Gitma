#!/bin/bash
# Phase 15 G5 (spec 028, decision 43; SRD Annex F §F.4): the EKF-fused tracker against the
# re-tuned EKF, with realistic bearing error. The commands that produce this folder, in order.
# Data and predictions are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p15; E=experiments/20261116-p15-g5
EKF="--sigma-a 0.03 --p0-scale 16 --r-scale 64 --guarded-init 1"
IMM="--sigma-cv 0 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 32 --r-scale 64 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. Data at a clean commit after decision 43: seed 211 (normalisation) and the fresh seed-233 test
#    split (40,000, phase-7 ranges) alone; digests and header ranges checked; T2's test features.
node scripts/train-plan.mjs data configs/phase4/x/plan.json $D test
mkdir -p $D/pred
# 2. The re-tuned EKF (reference) and IMM (reported), naive (reported), and the frozen T2.
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.ekf.ndjson --filter ekf $EKF &
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.imm.ndjson --filter imm $IMM &
node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $D/test.f32pack \
  --out $D/pred/test.naive.ndjson --per-timestep &
node packages/models/dist/cli-predict.js --model $T2 --truth $D/test.f32pack \
  --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack &
wait
# 3. The carried EKF-fused tracker, and Annex E's best IMM fusion (reported).
node packages/eval/dist/cli-fuse-track.js --truth $D/test.f32pack --network $D/pred/test.t2.ndjson \
  --out $D/pred/test.fused-ekf.ndjson --filter ekf --sigma-a 0.07 --p0-scale 16 --r-scale 64 \
  --guarded-init 1 --k 4 --every 3 &
node packages/eval/dist/cli-fuse-track.js --truth $D/test.f32pack --network $D/pred/test.t2.ndjson \
  --out $D/pred/test.fused-imm.ndjson $IMM --k 4 --every 12 &
wait
# 4. The gate, with every binding.
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/test.f32pack \
  --tracker $D/pred/test.fused-ekf.ndjson --reference $D/pred/test.ekf.ndjson \
  --also $D/pred/test.imm.ndjson --also $D/pred/test.fused-imm.ndjson --also $D/pred/test.t2.ndjson \
  --decision experiments/20261116-p15-decision/decision.json --plan configs/phase4/x/plan.json \
  --model $T2 --experiment $E || test $? -eq 3
( cd $D && sha256sum test.f32pack test.features.bin pred/*.ndjson ) > $E/predictions.sha256
# 5. Baselines, reported.
node --max-old-space-size=8192 scripts/research/spec019-baselines.mjs $D/test.f32pack $E/baselines.json \
  $D/pred/test.fused-ekf.ndjson $D/pred/test.ekf.ndjson $D/pred/test.imm.ndjson \
  $D/pred/test.fused-imm.ndjson $D/pred/test.t2.ndjson $D/pred/test.naive.ndjson
node --max-old-space-size=8192 scripts/research/spec014-lsq.mjs $D/test.f32pack $E/lsq.json
