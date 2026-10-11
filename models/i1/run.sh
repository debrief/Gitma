#!/usr/bin/env bash
# Iteration-1 training run (spec 002 T031). Idempotent: completed models are skipped,
# unfinished ones resume from their checkpoint.
set -u
cd /tmp/claude-0/-home-user-Gitma/dcd092d9-424c-5361-ad1e-25150a9009a2/scratchpad/trainwt
D=/home/user/Gitma/data/i1
M=/home/user/Gitma/models/i1
for m in instantaneous time-late causal-cnn mlp instantaneous-shuffled; do
  if [ -f $M/$m/manifest.json ] && grep -q '"complete": true' $M/$m/manifest.json; then
    echo "skip $m (complete)"; continue
  fi
  echo "=== $m start $(date -u +%FT%TZ)"
  node packages/models/dist/cli-train.js --config configs/iter1/$m.json \
    --train $D/train.features.bin --val $D/validation.features.bin --out $M/$m \
    --experiments experiments >> $M/$m.log 2>&1
  echo "=== $m exit $? $(date -u +%FT%TZ)"
done
echo ALL_DONE
