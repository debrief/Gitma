#!/bin/bash
# Spec 017 research (seed-211 validation only; no test split exists or is scored).
# Data and score files are regenerable and not committed; their SHA-256s are in predictions.sha256.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p6v; P=$D/pred; E=experiments/20261105-p5-research; mkdir -p $P
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
# 1. Seed-211 data from a clean tree at main (digests checked), validation features for T2:
#    node scripts/train-plan.mjs data configs/phase4/f/plan.json $D validation
# 2. The decision-32 reference IMM and the frozen T2 (decision 30's digests).
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $P/imm-g1.ndjson --filter imm $IMM
node packages/models/dist/cli-predict.js --model experiments/20261101-p4b-models/models/tracker \
  --truth $D/validation.f32pack --features $D/validation.features.bin --out $P/t2.ndjson --train $D/train.f32pack
# 3. The declared CUSUM grid and the two learned candidates.
run() { node packages/eval/dist/cli-detect.js --truth $D/validation.f32pack --out $P/cusum-$1-c$2-x$3.ndjson \
  --detector cusum $IMM --kind $1 --c $2 --clip $3; }
for c in 0.5 0.75 1 1.25; do for x in 2 5; do run nis $c $x; done; done
for c in 0.25 0.5 0.75 1; do run mean $c 3; done
node packages/eval/dist/cli-detect.js --truth $D/validation.f32pack --out $P/disagree.ndjson --detector disagree \
  --network $P/t2.ndjson --tracker $P/imm-g1.ndjson
node packages/eval/dist/cli-detect.js --truth $D/validation.f32pack --out $P/crate-w6.ndjson --detector crate \
  --network $P/t2.ndjson --window 6
# 4. Calibration at 0.5 false alarms per hour, and the G6 checks of the best of each kind (diagnostic).
node --max-old-space-size=8192 packages/eval/dist/cli-g6.js --truth $D/validation.f32pack \
  --learned $P/disagree.ndjson --learned $P/crate-w6.ndjson $(for f in $P/cusum-*.ndjson; do echo --cusum $f; done) \
  --experiment $E/validation
# 5. Reported, not gated: the same detectors at other false-alarm rates.
node --max-old-space-size=8192 scripts/research/spec017-sensitivity.mjs $D/validation.f32pack 0.5,1,2,5 \
  $P/crate-w6.ndjson $P/disagree.ndjson $P/cusum-mean-c0.5-x3.ndjson $P/cusum-mean-c0.25-x3.ndjson \
  $P/cusum-nis-c0.5-x5.ndjson > $E/sensitivity.json
sha256sum $D/validation.f32pack $P/*.ndjson > $E/predictions.sha256
