#!/bin/bash
# Phase 7 G5 (spec 019, decision 35; SRD Annex C §C.14): the frozen -g1 fused tracker against the
# frozen -g1 IMM with realistic bearing error. The commands that produced this folder, in order.
# Data and predictions are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p7; E=experiments/20261108-p7-g5
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. Data at a clean commit after decision 35: the seed-211 dataset (normalisation) and the fresh
#    seed-218 test split (40,000, phase-7 ranges) alone; digests and header ranges checked against
#    configs/phase4/w/plan.json; T2's derived test features.
node scripts/train-plan.mjs data configs/phase4/w/plan.json $D test
mkdir -p $D/pred
# 2. The reference IMM and the EKF (reported), both -g1, and the frozen T2, in parallel.
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.imm.ndjson --filter imm $IMM &
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.ekf.ndjson --filter ekf \
  --sigma-a 0.03 --p0-scale 4 --r-scale 8 --guarded-init 1 &
node packages/models/dist/cli-predict.js --model $T2 --truth $D/test.f32pack \
  --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack &
wait
# 3. The fused tracker on the -g1 IMM (k 4, every 6).
node packages/eval/dist/cli-fuse-track.js --truth $D/test.f32pack --network $D/pred/test.t2.ndjson \
  --out $D/pred/test.fused.ndjson $IMM
# 4. The gate, with every binding (the prediction chain needs T2's file among --also).
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/test.f32pack \
  --tracker $D/pred/test.fused.ndjson --reference $D/pred/test.imm.ndjson \
  --also $D/pred/test.t2.ndjson --also $D/pred/test.ekf.ndjson \
  --decision experiments/20261108-p7-decision/decision.json --plan configs/phase4/w/plan.json \
  --model $T2 --experiment $E || test $? -eq 3
( cd $D && sha256sum test.f32pack test.features.bin pred/*.ndjson ) > $E/predictions.sha256
# 5. After the verdict is committed (decision 35): seed 218's phase-4-range twin and the clean
#    comparison (scripts/research/spec019-clean.mjs), in a separate commit.
