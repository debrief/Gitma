#!/bin/bash
# Phase 16 validation (spec 029, SRD Annex G §G.2–G.3): the EKF-fused tracker with a range fade and
# adaptive process noise over fade × ceiling × NIS threshold (configs/phase16/fusion-grid.json,
# 36 variants), scored against Annex E's re-tuned IMM and EKF with six checks (G5's five and
# straight-leg course). Seed 217's validation split (phase-7 ranges), regenerated as phase 11 made
# it; T2 normalised from seed 211's train split (data/p15, content digest checked). Each variant's
# G5-row errors are extracted and its per-timestep file deleted (disk).
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p16val; E=experiments/20261118-p16-val; T2=experiments/20261101-p4b-models/models/tracker
T=$D/validation.f32pack; X="node --max-old-space-size=8192 scripts/research/spec029-rows.mjs $T"
EKF="--sigma-a 0.03 --p0-scale 16 --r-scale 64 --guarded-init 1"
IMM="--sigma-cv 0 --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 32 --r-scale 64 --guarded-init 1"
mkdir -p $D/pred $D/rows
# 0. Seed 211's train split must be the plan's (content digest 870aff4e…).
node scripts/train-plan.mjs digest data/p15/train.f32pack | grep -q '^870aff4e5f14d76b9da8b39e68c32cc64a9344ba97c2b535ef468c707db59208 '
# 1. Data: seed 217's validation split (phase-7 ranges), T2's features under seed 211's norm.
node scripts/generate-splits.mjs --seed 217 --count 100000 --ranges configs/phase7-ranges.json \
  --heldout-ranges configs/phase7-heldout-ranges.json --out $D --splits validation
node packages/features/dist/cli.js norm --train data/p15/train.f32pack --feature-set derived --out $D/norm.json
node packages/features/dist/cli.js build --in $T --norm $D/norm.json --feature-set derived \
  --out $D/validation.features.bin
# 2. References, T2, and phase 15's tracker.
node packages/classical/dist/cli-track.js --in $T --out $D/pred/ekf.ndjson --filter ekf $EKF &
node packages/classical/dist/cli-track.js --in $T --out $D/pred/imm.ndjson --filter imm $IMM &
node packages/models/dist/cli-predict.js --model $T2 --truth $T --features $D/validation.features.bin \
  --out $D/pred/t2.ndjson --train data/p15/train.f32pack
wait
node packages/eval/dist/cli-fuse-track.js --truth $T --network $D/pred/t2.ndjson --out $D/pred/p15.ndjson \
  --filter ekf --sigma-a 0.07 --p0-scale 16 --r-scale 64 --guarded-init 1 --k 4 --every 3
$X --flags > $D/rows/flags.json
for f in ekf imm t2 p15; do $X $D/pred/$f.ndjson > $D/rows/$f.json; done
( cd $D && sha256sum validation.f32pack pred/*.ndjson ) > $E/inputs.sha256
# 3. Consistency: the regenerated inputs reproduce phase 15's validation medians exactly.
node -e '
const g = require("./experiments/20261116-p15-val/grid.json");
const fs = require("fs");
const flags = JSON.parse(fs.readFileSync(process.argv[1] + "/flags.json"));
const med = (a) => { const b = Float64Array.from(a).sort(); return b[Math.floor((b.length - 1) / 2)]; };
for (const [name, key] of [["imm", "imm"], ["ekf", "ekf"], ["t2", "t2"]]) {
  const r = JSON.parse(fs.readFileSync(`${process.argv[1]}/${name}.json`)).rows;
  const v = (i, j) => (r[i] ?? [Infinity, Infinity, Infinity])[j];
  const all = r.map((_, i) => i), st = all.filter((i) => flags.rows[i] >= 1);
  const got = { all: [0, 1, 2].map((j) => med(all.map((i) => v(i, j)))), settled: [0, 1, 2].map((j) => med(st.map((i) => v(i, j)))) };
  if (JSON.stringify(got) !== JSON.stringify(g.medians[key])) { console.error(name, got, g.medians[key]); process.exit(1); }
}
console.log("phase-15 validation medians reproduced");' $D/rows
# 4. The grid, four at a time.
for fd in 0 0.5 1 2; do
  for hi in 0.07 0.1 0.2; do
    for eta in 0.03 0.06 0.12; do
      f=$D/fe-f$fd-a$hi-e$eta
      ( node packages/eval/dist/cli-fuse-track.js --truth $T --network $D/pred/t2.ndjson --out $f.ndjson \
          --filter ekf $EKF --k 4 --every 3 --fade $fd --adapt-hi $hi --adapt-eta $eta > /dev/null \
        && sha256sum $f.ndjson >> $D/variants.sha256 \
        && $X $f.ndjson > $D/rows/fe-f$fd-a$hi-e$eta.json && rm $f.ndjson ) &
      while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 5; done
    done
  done
done
wait
[ "$(ls $D/rows/fe-*.json | wc -l)" -eq 36 ] || { echo "missing variants"; exit 1; }
# 5. The selection.
node --max-old-space-size=8192 scripts/research/spec029-fuse-grid.mjs $D/rows/imm.json $D/rows/ekf.json \
  $D/rows/t2.json $D/rows/p15.json $D/rows/flags.json $D/rows/fe-*.json > $E/grid.json
sort -k2 $D/variants.sha256 > $E/variants.sha256
