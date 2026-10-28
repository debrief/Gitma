#!/bin/bash
set -e
cd /home/user/Gitma
D=data/i5; E=experiments/20261028-i5-g3
log() { echo "$(date -u +%FT%TZ) $*" | tee -a /tmp/claude-0/-home-user-Gitma/dcd092d9-424c-5361-ad1e-25150a9009a2/scratchpad/g3run/steps.log; }
log "start commit $(git rev-parse --short HEAD) status '$(git status --short | wc -l)'"
log features; pnpm -s tma-features build --in $D/test.f32pack --norm $D/norm.lstm.json --feature-set derived --out $D/test.features.bin
log lstm; NODE_OPTIONS=--max-old-space-size=8192 pnpm -s tma-model-predict --model experiments/20261023-i4a-val/models/lstm-instantaneous --truth $D/test.f32pack --features $D/test.features.bin --out $D/test.lstm.ndjson
log classical; pnpm -s tma-solve --in $D/test.f32pack --out $D/test.classical.ndjson --per-timestep
log naive; pnpm -s tma-naive fit --train data/i4/train.f32pack --out $D/naive.json
pnpm -s tma-naive predict --model $D/naive.json --in $D/test.f32pack --out $D/test.naive.ndjson --per-timestep
log hybrid; pnpm -s tma-hybrid --truth $D/test.f32pack --classical $D/test.classical.ndjson --network $D/test.lstm.ndjson --out $D/test.hybrid.ndjson
log eval; NODE_OPTIONS=--max-old-space-size=8192 pnpm -s tma-eval --truth $D/test.f32pack --pred $D/test.naive.ndjson --pred $D/test.classical.ndjson --pred $D/test.lstm.ndjson --pred $D/test.hybrid.ndjson --experiment $E --points 300,600 --bootstrap 2000 --compare-to classical:per_timestep
log g3; set +e; pnpm -s tma-g3 --truth $D/test.f32pack --hybrid $D/test.hybrid.ndjson --classical $D/test.classical.ndjson --decision experiments/20261027-i5-decision/decision.json --experiment $E; echo "g3 exit $?" | tee -a /tmp/claude-0/-home-user-Gitma/dcd092d9-424c-5361-ad1e-25150a9009a2/scratchpad/g3run/steps.log
log done
