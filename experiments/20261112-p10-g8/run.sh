#!/bin/bash
# Phase 10 G8 (spec 022, decision 38; SRD Annex C §C.17): the hybrid of T2's range with the frozen
# -g1 fused tracker's velocity, against the -g1 IMM and beating the fused tracker on range, with
# realistic bearing error. The commands that produced this folder, in order. Data and predictions
# are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p10; E=experiments/20261112-p10-g8
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. Data at a clean commit after decision 38: seed 211 (normalisation) and the fresh seed-224 test
#    split (40,000, phase-7 ranges) alone; digests and header ranges checked; T2's test features.
node scripts/train-plan.mjs data configs/phase4/z/plan.json $D test
mkdir -p $D/pred
# 2. The -g1 IMM and EKF (reported), naive (reported), and the frozen T2, in parallel.
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.imm.ndjson --filter imm $IMM &
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.ekf.ndjson --filter ekf \
  --sigma-a 0.03 --p0-scale 4 --r-scale 8 --guarded-init 1 &
node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $D/test.f32pack \
  --out $D/pred/test.naive.ndjson --per-timestep &
node packages/models/dist/cli-predict.js --model $T2 --truth $D/test.f32pack \
  --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack &
wait
# 3. The fused tracker (k 4, every 6) and the hybrid (theta 180).
node packages/eval/dist/cli-fuse-track.js --truth $D/test.f32pack --network $D/pred/test.t2.ndjson \
  --out $D/pred/test.fused.ndjson $IMM
node packages/eval/dist/cli-hybrid-track.js --truth $D/test.f32pack --tracker $D/pred/test.fused.ndjson \
  --network $D/pred/test.t2.ndjson --out $D/pred/test.hybrid.ndjson --course-deg 180
# 4. The gate, with every binding.
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/test.f32pack \
  --tracker $D/pred/test.hybrid.ndjson --reference $D/pred/test.imm.ndjson \
  --beat $D/pred/test.fused.ndjson --also $D/pred/test.t2.ndjson --also $D/pred/test.ekf.ndjson \
  --decision experiments/20261112-p10-decision/decision.json --plan configs/phase4/z/plan.json \
  --model $T2 --experiment $E || test $? -eq 3
( cd $D && sha256sum test.f32pack test.features.bin pred/*.ndjson ) > $E/predictions.sha256
# 5. Baselines, reported.
node --max-old-space-size=8192 scripts/research/spec019-baselines.mjs $D/test.f32pack $E/baselines.json \
  $D/pred/test.hybrid.ndjson $D/pred/test.imm.ndjson $D/pred/test.fused.ndjson $D/pred/test.t2.ndjson \
  $D/pred/test.ekf.ndjson $D/pred/test.naive.ndjson
node --max-old-space-size=8192 scripts/research/spec014-lsq.mjs $D/test.f32pack $E/lsq.json
