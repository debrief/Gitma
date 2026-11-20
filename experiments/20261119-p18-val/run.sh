#!/bin/bash
# Phase 18 validation (spec 031, SRD Annex I §I.2): the early-alarm detector against phase 17's 16
# re-tuned CUSUMs on seed 217's validation split, at 0.5 false alarms per quiet hour, under G6 rules
# h (Annex H §H.2's protocol, unchanged). Phase 17's split and CUSUM detection files are reused
# after their SHA-256s are checked against experiments/20261118-p17-val/inputs.sha256.
# Usage: run.sh <committed detector model dir>.
set -e
cd "$(git rev-parse --show-toplevel)"
M=${1:?usage: run.sh <detector model dir>}
P=data/p17val; D=data/p18val; E=experiments/20261119-p18-val; T=$P/validation.f32pack
mkdir -p $D/pred $D/det
# 1. Phase 17's split, CUSUMs and reported detectors, byte for byte.
( cd $P && sha256sum -c ../../experiments/20261118-p17-val/inputs.sha256 )
# 2. Seed 241's train split (the detector's normalisation), features, predictions, detection file.
node scripts/generate-splits.mjs --seed 241 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D/s241 --splits train
node scripts/train-plan.mjs digest $D/s241/train.f32pack | grep -q '^8298a3d571dc1ed00fe57a7657f3b94f2f769bab2f71eb813b1ee16c2f401eb4 '
node packages/features/dist/cli.js norm --train $D/s241/train.f32pack --feature-set derived --out $D/norm241.json
node packages/features/dist/cli.js build --in $T --norm $D/norm241.json --feature-set derived \
  --out $D/validation.features241.bin
node packages/models/dist/cli-predict.js --model $M --truth $T --features $D/validation.features241.bin \
  --out $D/pred/det.ndjson --train $D/s241/train.f32pack
node packages/eval/dist/cli-detect.js --truth $T --out $D/det/learned.ndjson --detector model --network $D/pred/det.ndjson
# 3. The G6 diagnostic under rules h, and the other operating points (reported).
CUSUMS=$(for f in $P/det/cusum-*.ndjson; do echo --cusum $f; done)
node --max-old-space-size=12288 packages/eval/dist/cli-g6.js --truth $T --rules h \
  --learned $D/det/learned.ndjson $CUSUMS --experiment $E/validation
node --max-old-space-size=12288 scripts/research/spec030-rates.mjs $T $D/det/learned.ndjson \
  $P/det/learned.ndjson $P/det/crate.ndjson $P/det/cusum-rt-mean-c0.25.ndjson > $E/rates.json
( cd $D && sha256sum pred/det.ndjson det/learned.ndjson ) > $E/inputs.sha256
