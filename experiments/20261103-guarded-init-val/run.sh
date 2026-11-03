#!/bin/bash
# Spec 016 research (validation only, seed 211; report, no gate): the guarded (re-)initialisation
# (-g1, -g2) against the frozen trackers. Data and predictions are regenerable and not committed.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p4v; P=$D/pred; E=experiments/20261103-guarded-init-val; mkdir -p $P
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8"
EKF="--sigma-a 0.03 --p0-scale 4 --r-scale 8"
# 1. Seed-211 data from a clean tree (digests checked); validation features for T2.
#    node scripts/train-plan.mjs data configs/phase4/f/plan.json $D validation
# 2. The frozen IMM and EKF (decision 29) and their guarded variants; the frozen T2.
for g in 0 1 2; do
  flag=""; [ $g -gt 0 ] && flag="--guarded-init $g"
  node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $P/imm-g$g.ndjson --filter imm $IMM $flag &
  node packages/classical/dist/cli-track.js --in $D/validation.f32pack --out $P/ekf-g$g.ndjson --filter ekf $EKF $flag &
done
node packages/models/dist/cli-predict.js --model experiments/20261101-p4b-models/models/tracker \
  --truth $D/validation.f32pack --features $D/validation.features.bin --out $P/t2.ndjson --train $D/train.f32pack &
wait
# 3. The fused tracker (decision 31, k 4, every 6) on each IMM level.
for g in 0 1 2; do
  flag=""; [ $g -gt 0 ] && flag="--guarded-init $g"
  node packages/eval/dist/cli-fuse-track.js --truth $D/validation.f32pack --network $P/t2.ndjson \
    --out $P/fused-g$g.ndjson $IMM $flag &
done
wait
# 4. G5 diagnostics (validation: no bindings, nothing is gated): levels 1 and 2 against level 0.
g5() { node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/validation.f32pack \
  --tracker $P/$1-g1.ndjson --tracker $P/$1-g2.ndjson --reference $P/$1-g0.ndjson --experiment $E/$1; }
g5 imm & g5 ekf & g5 fused & wait
# 5. Non-positive-definite steps and non-converged rows of the IMM at each level.
for g in 0 1 2; do
  node scripts/research/spec015-imm-covariance.mjs count $D/validation.f32pack $g > $E/non-pd-g$g.json &
done
wait
sha256sum $D/validation.f32pack $P/*.ndjson > $E/predictions.sha256
