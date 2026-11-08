#!/bin/bash
# Phase 6 G7 re-score (spec 018, decision 34; the one re-score of experiments/20261106-p6u-g7): the commands that produced this folder, in order.
# Data and predictions are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p6v; E=experiments/20261106-p6v-g7
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1 --report-sd"
# 1. Data at a clean commit after decision 34: seed-211 dataset + fresh seed-216 test split (110,000) alone;
#    every digest checked against configs/phase4/v/plan.json; T2's derived test features.
node scripts/train-plan.mjs data configs/phase4/v/plan.json $D test
mkdir -p $D/pred
# 2. The reference IMM (decision 32, -g1, with stated sds) and the frozen T2, in parallel.
node packages/classical/dist/cli-track.js --in $D/test.f32pack --out $D/pred/test.imm.ndjson --filter imm $IMM &
node packages/models/dist/cli-predict.js --model experiments/20261101-p4b-models/models/tracker \
  --truth $D/test.f32pack --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack &
wait
# 3. The fused tracker on the -g1 IMM, with stated sds (k 4, every 6, the CLI defaults).
node packages/eval/dist/cli-fuse-track.js --truth $D/test.f32pack --network $D/pred/test.t2.ndjson \
  --out $D/pred/test.fused.ndjson $IMM
# 4. The gate, with every binding (the prediction chain needs T2's file among --also). The rows are streamed:
#    the gate peaked at about 0.4 GB on this split; the heap flag is a margin only.
node --max-old-space-size=12288 packages/eval/dist/cli-g7.js --truth $D/test.f32pack \
  --tracker $D/pred/test.fused.ndjson --reference $D/pred/test.imm.ndjson --also $D/pred/test.t2.ndjson \
  --decision experiments/20261106-p6v-rescore-decision/decision.json --plan configs/phase4/v/plan.json \
  --model experiments/20261101-p4b-models/models/tracker --experiment $E
sha256sum $D/test.f32pack $D/test.features.bin $D/pred/*.ndjson > $E/predictions.sha256
