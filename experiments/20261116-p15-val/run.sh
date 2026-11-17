#!/bin/bash
# Phase 15 validation (spec 028, SRD Annex F §F.2–F.3): the frozen T2's range fused into the EKF
# (re-tuned P0 and R from Annex E) over σa × k × M (configs/phase15/fusion-grid.json, 96 variants),
# scored against Annex E's re-tuned IMM and EKF with the pre-registered selection. Seed 217's
# validation split and T2's predictions are phase 11's (experiments/20261114-p11-val/run.sh);
# the re-tuned references are phase 14's (experiments/20261115-p14-val/run.sh, inputs.sha256).
# Each variant's G5-row errors are extracted and its per-timestep file deleted (disk).
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p11val/real; R=data/p14val; P=data/p15val; E=experiments/20261116-p15-val
T=$D/validation.f32pack
mkdir -p $P/rows
# 0. The inputs' digests must match the earlier phases' (re-tuned references, T2, split).
( cd . && grep -E "validation.f32pack|pred/t2.ndjson|p14val/(imm|ekf).ndjson" \
  experiments/20261115-p14-val/inputs.sha256 | sha256sum -c - )
# 1. Compact G5-row errors of the references, T2, Annex E's best fused tracker, and settled flags.
X="node --max-old-space-size=8192 scripts/research/spec028-rows.mjs $T"
$X --settled > $P/rows/settled.json
$X $R/imm.ndjson > $P/rows/imm.json
$X $R/ekf.ndjson > $P/rows/ekf.json
$X $D/pred/t2.ndjson > $P/rows/t2.json
IMM="--sigma-cv 0 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 32 --r-scale 64 --guarded-init 1"
node packages/eval/dist/cli-fuse-track.js --truth $T --network $D/pred/t2.ndjson \
  --out $P/fused-imm.ndjson $IMM --k 4 --every 12 > /dev/null
$X $P/fused-imm.ndjson > $P/rows/fused-imm.json
sha256sum $P/fused-imm.ndjson > $E/fused-imm.sha256
rm $P/fused-imm.ndjson
# 2. The grid, four at a time.
for sa in 0.03 0.05 0.07 0.1; do
  for k in 0.5 1 1.5 2 3 4; do
    for m in 1 3 6 12; do
      f=$P/fe-sa$sa-k$k-m$m
      ( node packages/eval/dist/cli-fuse-track.js --truth $T --network $D/pred/t2.ndjson \
          --out $f.ndjson --filter ekf --sigma-a $sa --p0-scale 16 --r-scale 64 --guarded-init 1 \
          --k $k --every $m > /dev/null \
        && sha256sum $f.ndjson >> $P/variants.sha256 \
        && $X $f.ndjson > $P/rows/fe-sa$sa-k$k-m$m.json && rm $f.ndjson ) &
      while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
    done
  done
done
wait
[ "$(ls $P/rows/fe-*.json | wc -l)" -eq 96 ] || { echo "missing variants"; exit 1; }
# 3. The selection.
node --max-old-space-size=8192 scripts/research/spec028-fuse-grid.mjs $P/rows/imm.json \
  $P/rows/ekf.json $P/rows/t2.json $P/rows/fused-imm.json $P/rows/settled.json $P/rows/fe-*.json \
  > $E/grid.json
sort -k2 $P/variants.sha256 > $E/variants.sha256
