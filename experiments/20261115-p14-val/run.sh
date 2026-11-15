#!/bin/bash
# Phase 14 validation (spec 027, SRD Annex E §E.2–E.3): re-tune the IMM and EKF references to
# realistic bearing error, fuse the frozen T2 into the re-tuned IMM over phase 8's k × M grid, and
# apply the pre-registered selection. Seed 217's validation split (phase-7 ranges) and its frozen T2
# and fused-tracker predictions are phase 11's (experiments/20261114-p11-val/run.sh regenerates
# them). Data are regenerable, not committed.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p11val/real; P=data/p14val; E=experiments/20261115-p14-val
mkdir -p $P
# 1. Re-tune both references (scripts/research/spec027-tune.mjs, configs/phase14/tracker-grid.json).
node --max-old-space-size=8192 scripts/research/spec027-tune.mjs $D/validation.f32pack \
  configs/phase14/tracker-grid.json $E/tune.json > /dev/null
IMM=$(node -e 'const p=require("./'$E'/tune.json").best_imm.params; console.log(`--sigma-cv ${p.sigmaCv} --sigma-ct ${p.sigmaCt} --sigma-omega ${p.sigmaOmega} --switch ${p.switchPerS} --p0-scale ${p.p0Scale} --r-scale ${p.rScale} --guarded-init 1`)')
EKF=$(node -e 'const e=require("./'$E'/tune.json").best_ekf; console.log(`--sigma-a ${e.sigmaA} --p0-scale ${e.p0Scale} --r-scale ${e.rScale} --guarded-init 1`)')
echo "IMM: $IMM"; echo "EKF: $EKF"
# 2. The re-tuned references' predictions.
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $P/imm.ndjson --filter imm $IMM &
node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $P/ekf.ndjson --filter ekf $EKF &
wait
# 3. The fusion grid on the re-tuned IMM: k in {0.5, 1, 1.5, 2, 3, 4} x M in {1, 3, 6, 12}.
for k in 0.5 1 1.5 2 3 4; do
  for m in 1 3 6 12; do
    node packages/eval/dist/cli-fuse-track.js --truth $D/validation.f32pack --network $D/pred/t2.ndjson \
      --out $P/fused-k$k-m$m.ndjson $IMM --k $k --every $m > /dev/null &
    while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
  done
done
wait
# 4. The selection (scripts/research/spec027-fuse-grid.mjs).
node --max-old-space-size=12288 scripts/research/spec027-fuse-grid.mjs $D/validation.f32pack \
  $P/imm.ndjson $P/ekf.ndjson $D/pred/t2.ndjson $D/pred/fused-t2.ndjson $P/fused-k*.ndjson > $E/grid.json
( sha256sum $D/validation.f32pack $D/pred/t2.ndjson $D/pred/fused-t2.ndjson $P/*.ndjson ) > $E/inputs.sha256
