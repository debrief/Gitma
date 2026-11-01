#!/bin/bash
# Phase 4b G5 (spec 013, decision 30): the commands that produced this folder, in order.
# Data and predictions are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p4h; E=experiments/20261101-p4h-g5
# 1. Data at a clean commit: seed-211 dataset + fresh seed-213 test split alone; every digest checked
#    against configs/phase4/h/plan.json; T2's derived test features with the seed-211 training norm.
node scripts/train-plan.mjs data configs/phase4/h/plan.json $D test
# 2. The frozen reference IMM (decision 29), the EKF and naive (reported beside it).
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.imm.ndjson --filter imm \
  --sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.ekf.ndjson --filter ekf \
  --sigma-a 0.03 --p0-scale 4 --r-scale 8
node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $D/test.f32pack \
  --out $D/pred/test.naive.ndjson --per-timestep   # naive fitted on seed-211 train (same content digest)
# 3. The frozen T2 (weights bound by decision 30 model_digests).
node packages/models/dist/cli-predict.js --model experiments/20261101-p4b-models/models/tracker \
  --truth $D/test.f32pack --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack
# 4. The hybrid (θ = 45°, the CLI default and decision 30's value).
node packages/eval/dist/cli-hybrid-track.js --truth $D/test.f32pack --tracker $D/pred/test.imm.ndjson \
  --network $D/pred/test.t2.ndjson --out $D/pred/test.hybrid.ndjson
# 5. The gate, with every binding.
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/test.f32pack \
  --tracker $D/pred/test.hybrid.ndjson --reference $D/pred/test.imm.ndjson \
  --also $D/pred/test.t2.ndjson --also $D/pred/test.ekf.ndjson --also $D/pred/test.naive.ndjson \
  --decision experiments/20261101-p4h-decision/decision.json --plan configs/phase4/h/plan.json \
  --model experiments/20261101-p4b-models/models/tracker --experiment $E
