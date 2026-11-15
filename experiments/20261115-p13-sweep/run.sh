#!/bin/bash
# Spec 026 (research, no gate): a bearing-error severity sweep on seed 217's validation split.
# Both realistic-error terms (Gauss–Markov 1.0°/30 s and drifting bias 0.5°/20 min) are scaled
# together: ×0 (white noise only: the phase-4 ranges, the clean twin), ×0.5, ×1 (the phase-7
# ranges) and ×2. Every estimator is frozen: the -g1 IMM and EKF, T2 (seed 211's normalisation),
# the fused tracker, batch least squares at every timestep, naive, and Annex D's first composite
# (W 6, c 8) for reference; beside the Cramér–Rao bound (spec 024). ×0 and ×1 reuse the data and
# predictions of experiments/20261114-p11-val (data/p11val). Committed before it is run.
set -e
cd "$(git rev-parse --show-toplevel)"
P=data/p11val; S=data/p13sweep; E=experiments/20261115-p13-sweep
IMM="--sigma-cv 0.01 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8 --guarded-init 1"
T2=experiments/20261101-p4b-models/models/tracker
# 1. ×0.5 and ×2 at a clean commit; their features, trackers, T2 and the fused tracker.
for x in 0.5 2; do
  V=$S/x$x; mkdir -p $V/pred
  node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/phase7-x$x-ranges.json \
    --heldout-ranges configs/phase7-heldout-ranges.json --out $V --splits validation
  node packages/features/dist/cli.js build --in $V/validation.f32pack --norm $P/norm211.json \
    --feature-set derived --out $V/validation.features211.bin
  node packages/classical/dist/cli-track.js --in $V/validation.f32pack --out $V/pred/imm.ndjson --filter imm $IMM &
  node packages/classical/dist/cli-track.js --in $V/validation.f32pack --out $V/pred/ekf.ndjson --filter ekf \
    --sigma-a 0.03 --p0-scale 4 --r-scale 8 --guarded-init 1 &
  node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $V/validation.f32pack \
    --out $V/pred/naive.ndjson --per-timestep &
  node packages/models/dist/cli-predict.js --model $T2 --truth $V/validation.f32pack \
    --features $V/validation.features211.bin --out $V/pred/t2.ndjson --train $P/s211/train.f32pack &
  wait
  node packages/eval/dist/cli-fuse-track.js --truth $V/validation.f32pack --network $V/pred/t2.ndjson \
    --out $V/pred/fused-t2.ndjson $IMM
done
# 2. Least squares at every timestep where it is missing (×1 has it from experiments/20261115-p12-val).
for V in $P/clean $S/x0.5 $S/x2; do
  node packages/classical/dist/cli-solve.js --in $V/validation.f32pack --out $V/pred/lsq.ndjson \
    --per-timestep --workers 4
done
# 3. Per severity: Annex D's first composite, baselines (carried: the fused tracker) and the bound.
for pair in x0:$P/clean:--clean x0.5:$S/x0.5:configs/phase7-x0.5-ranges.json \
  x1:$P/real:configs/phase7-ranges.json x2:$S/x2:configs/phase7-x2-ranges.json; do
  x=${pair%%:*}; rest=${pair#*:}; V=${rest%%:*}; M=${rest#*:}
  node packages/eval/dist/cli-composite.js --truth $V/validation.f32pack --classical $V/pred/lsq.ndjson \
    --fused $V/pred/fused-t2.ndjson --out $V/pred/composite.ndjson --window 6 --threshold 8
  node --max-old-space-size=12288 scripts/research/spec019-baselines.mjs $V/validation.f32pack \
    $E/baselines-$x.json $V/pred/fused-t2.ndjson $V/pred/imm.ndjson $V/pred/ekf.ndjson $V/pred/t2.ndjson \
    $V/pred/lsq.ndjson $V/pred/composite.ndjson $V/pred/naive.ndjson
  node --max-old-space-size=8192 scripts/research/spec024-crb.mjs $V/validation.f32pack $M $E/crb-$x.json \
    fused=$V/pred/fused-t2.ndjson imm=$V/pred/imm.ndjson ekf=$V/pred/ekf.ndjson t2=$V/pred/t2.ndjson \
    lsqpt=$V/pred/lsq.ndjson composite=$V/pred/composite.ndjson naive=$V/pred/naive.ndjson
done
node scripts/research/spec026-sweep.mjs $E > $E/sweep.json
( sha256sum $P/clean/validation.f32pack $P/real/validation.f32pack $S/x0.5/validation.f32pack \
  $S/x2/validation.f32pack $P/clean/pred/*.ndjson $P/real/pred/{fused-t2,imm,ekf,t2,lsq,composite,naive}.ndjson \
  $S/x*/pred/*.ndjson ) > $E/inputs.sha256
