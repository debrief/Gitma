#!/bin/bash
# Phase 4c G5 (spec 014, decision 31): the commands that produced this folder, in order.
# Data and predictions are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p4f; E=experiments/20261102-p4f-g5
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8"
# 1. Data at a clean commit after decision 31: seed-211 dataset + fresh seed-214 test split alone;
#    every digest checked against configs/phase4/f/plan.json; T2's derived test features.
node scripts/train-plan.mjs data configs/phase4/f/plan.json $D test
# 2. In parallel: the frozen reference IMM (decision 29), the EKF, naive, and the frozen T2.
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.imm.ndjson --filter imm $IMM &
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.ekf.ndjson --filter ekf \
  --sigma-a 0.03 --p0-scale 4 --r-scale 8 &
node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $D/test.f32pack \
  --out $D/pred/test.naive.ndjson --per-timestep &   # naive fitted on seed-211 train (same content digest)
node packages/models/dist/cli-predict.js --model experiments/20261101-p4b-models/models/tracker \
  --truth $D/test.f32pack --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack &
wait
# 3. The fused tracker (decision 31: k 4, every 6, the CLI defaults) and the phase-4b hybrid (reported).
node packages/eval/dist/cli-fuse-track.js --truth $D/test.f32pack --network $D/pred/test.t2.ndjson \
  --out $D/pred/test.fused.ndjson $IMM
node packages/eval/dist/cli-hybrid-track.js --truth $D/test.f32pack --tracker $D/pred/test.imm.ndjson \
  --network $D/pred/test.t2.ndjson --out $D/pred/test.hybrid.ndjson
# 4. The gate, with every binding (the prediction chain needs T2's file among --also).
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/test.f32pack \
  --tracker $D/pred/test.fused.ndjson --reference $D/pred/test.imm.ndjson \
  --also $D/pred/test.t2.ndjson --also $D/pred/test.hybrid.ndjson --also $D/pred/test.ekf.ndjson \
  --also $D/pred/test.naive.ndjson \
  --decision experiments/20261102-p4f-decision/decision.json --plan configs/phase4/f/plan.json \
  --model experiments/20261101-p4b-models/models/tracker --experiment $E
