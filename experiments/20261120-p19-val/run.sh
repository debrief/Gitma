#!/bin/bash
# Phase 19, step 2 (spec 032, SRD Annex J §J.3): the time-late network against the tuned smoothers
# (tune.json, step 1) and Annex E's re-tuned forward EKF and IMM on seed 217's validation split,
# by six checks; reported: the real-time T2, phase 15's fused EKF tracker and batch least squares.
# Usage: run.sh <committed time-late model dir>.
set -e
cd "$(git rev-parse --show-toplevel)"
M=${1:?usage: run.sh <time-late model dir>}
P=data/p17val; D=data/p19val; E=experiments/20261120-p19-val; T=$P/validation.f32pack
T2=experiments/20261101-p4b-models/models/tracker
X="node --max-old-space-size=8192 scripts/research/spec029-rows.mjs $T"
mkdir -p $D/pred $D/rows
echo "cdceee4f32c92d16eec9b35a99483e1bd17234f92e10c18c3a7274aa222ac2c1  $T" | sha256sum -c -
# 1. Seed 244's train split (the network's normalisation) and features; seed 211's for T2.
node scripts/generate-splits.mjs --seed 244 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D/s244 --splits train
node scripts/train-plan.mjs digest $D/s244/train.f32pack | grep -q '^2749dc5b5784b7a711a22109664afdd29a743156c1c2384b2b3d62438f27bf24 '
node scripts/train-plan.mjs digest data/p15/train.f32pack | grep -q '^870aff4e5f14d76b9da8b39e68c32cc64a9344ba97c2b535ef468c707db59208 '
node packages/features/dist/cli.js norm --train $D/s244/train.f32pack --feature-set derived --out $D/norm244.json
node packages/features/dist/cli.js build --in $T --norm $D/norm244.json --feature-set derived \
  --out $D/validation.features244.bin
# 2. Predictions: the network, the two tuned smoothers, the forward references, T2, phase 15's tracker.
node packages/models/dist/cli-predict.js --model $M --truth $T --features $D/validation.features244.bin \
  --out $D/pred/tl.ndjson --train $D/s244/train.f32pack
node packages/models/dist/cli-predict.js --model $T2 --truth $T --features $P/validation.features211.bin \
  --out $D/pred/t2.ndjson --train data/p15/train.f32pack
EKFS=$(node -e 'const b=require("./'$E'/tune.json").best_ekfs; console.log(`--sigma-a ${b.sigmaA} --p0-scale ${b.scales.p0Scale} --r-scale ${b.scales.rScale} --guarded-init ${b.scales.guardedInit}`)')
IMMS=$(node -e 'const p=require("./'$E'/tune.json").best_imms.imm; console.log(`--sigma-cv ${p.sigmaCv} --sigma-ct ${p.sigmaCt} --sigma-omega ${p.sigmaOmega} --switch ${p.switchPerS} --p0-scale ${p.p0Scale} --r-scale ${p.rScale} --guarded-init ${p.guardedInit}`)')
node packages/classical/dist/cli-track.js --in $T --out $D/pred/ekfs.ndjson --filter ekf-smooth $EKFS &
node packages/classical/dist/cli-track.js --in $T --out $D/pred/imms.ndjson --filter imm-smooth $IMMS &
node packages/classical/dist/cli-track.js --in $T --out $D/pred/ekf.ndjson --filter ekf \
  --sigma-a 0.03 --p0-scale 16 --r-scale 64 --guarded-init 1 &
node packages/classical/dist/cli-track.js --in $T --out $D/pred/imm.ndjson --filter imm \
  --sigma-cv 0 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 32 --r-scale 64 --guarded-init 1 &
wait
node packages/eval/dist/cli-fuse-track.js --truth $T --network $D/pred/t2.ndjson --out $D/pred/p15.ndjson \
  --filter ekf --sigma-a 0.07 --p0-scale 16 --r-scale 64 --guarded-init 1 --k 4 --every 3
node packages/classical/dist/cli-solve.js --in $T --out $D/pred/lsq.ndjson --per-timestep --workers 4
# 3. Rows and the selection.
$X --flags > $D/rows/flags.json
for f in tl ekfs imms ekf imm t2 p15 lsq; do $X $D/pred/$f.ndjson > $D/rows/$f.json; done
node scripts/research/spec032-select.mjs $D/rows/tl.json $D/rows/flags.json \
  --ref $D/rows/ekfs.json $D/rows/imms.json $D/rows/ekf.json $D/rows/imm.json \
  --also $D/rows/t2.json $D/rows/p15.json $D/rows/lsq.json > $E/select.json
( cd $D && sha256sum pred/*.ndjson ) > $E/inputs.sha256
