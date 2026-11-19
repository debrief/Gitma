#!/bin/bash
# Phase 17 validation (spec 030, SRD Annex H §H.2): the trained detector against 16 CUSUMs re-tuned
# to realistic error, on seed 217's validation split, at 0.5 false alarms per quiet hour, under
# G6 rules h. Usage: run.sh <committed detector model dir> (its digests go into decision 45).
# T2 (for the reported course-rate detector) normalised from seed 211's train split (data/p15);
# the detector from seed 238's train split.
set -e
cd "$(git rev-parse --show-toplevel)"
M=${1:?usage: run.sh <detector model dir>}
D=data/p17val; E=experiments/20261118-p17-val; T2=experiments/20261101-p4b-models/models/tracker
T=$D/validation.f32pack
G1="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
RT="--sigma-cv 0 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 32 --r-scale 64 --guarded-init 1"
mkdir -p $D/pred $D/det
# 1. Data: seed 217 validation (phase-7 ranges); seed 238's train split for the detector's norm.
node scripts/train-plan.mjs digest data/p15/train.f32pack | grep -q '^870aff4e5f14d76b9da8b39e68c32cc64a9344ba97c2b535ef468c707db59208 '
node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D --splits validation
node scripts/generate-splits.mjs --seed 238 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D/s238 --splits train
node scripts/train-plan.mjs digest $D/s238/train.f32pack | grep -q '^c9579b3348342d4747eb3de30d8e36ac91e9504a8004df0149ddc9657431924d '
for s in 211:data/p15 238:$D/s238; do
  node packages/features/dist/cli.js norm --train ${s#*:}/train.f32pack --feature-set derived --out $D/norm${s%%:*}.json
  node packages/features/dist/cli.js build --in $T --norm $D/norm${s%%:*}.json --feature-set derived \
    --out $D/validation.features${s%%:*}.bin
done
# 2. The detector and T2.
node packages/models/dist/cli-predict.js --model $M --truth $T --features $D/validation.features238.bin \
  --out $D/pred/det.ndjson --train $D/s238/train.f32pack
node packages/models/dist/cli-predict.js --model $T2 --truth $T --features $D/validation.features211.bin \
  --out $D/pred/t2.ndjson --train data/p15/train.f32pack
node packages/eval/dist/cli-detect.js --truth $T --out $D/det/learned.ndjson --detector model --network $D/pred/det.ndjson
node packages/eval/dist/cli-detect.js --truth $T --out $D/det/crate.ndjson --detector crate --network $D/pred/t2.ndjson --window 6
# 3. The 16 CUSUMs, four at a time.
for imm in g1 rt; do
  F=$G1; [ $imm = rt ] && F=$RT
  for c in 0.1 0.25 0.5 1; do
    node packages/eval/dist/cli-detect.js --truth $T --out $D/det/cusum-$imm-mean-c$c.ndjson --detector cusum $F \
      --kind mean --c $c --clip 3 > /dev/null &
    while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
  done
  for c in 0.05 0.1 0.25 0.5; do
    node packages/eval/dist/cli-detect.js --truth $T --out $D/det/cusum-$imm-nis-c$c.ndjson --detector cusum $F \
      --kind nis --c $c --clip 5 > /dev/null &
    while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
  done
done
wait
# 4. Calibration, selection and the G6 diagnostic under rules h: the carried detector (det), then
#    the reported course-rate detector against the same CUSUMs.
CUSUMS=$(for f in $D/det/cusum-*.ndjson; do echo --cusum $f; done)
node --max-old-space-size=12288 packages/eval/dist/cli-g6.js --truth $T --rules h \
  --learned $D/det/learned.ndjson $CUSUMS --experiment $E/validation
node --max-old-space-size=12288 packages/eval/dist/cli-g6.js --truth $T --rules h \
  --learned $D/det/crate.ndjson $CUSUMS --experiment $E/validation-crate
( cd $D && sha256sum validation.f32pack pred/*.ndjson det/*.ndjson ) > $E/inputs.sha256
