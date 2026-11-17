# Phase 15 G5: recovery after a container restart

`experiments/20261116-p15-g5/run.sh` ran to the end of `cli-g5`'s verdict: `verdict.json` and
`scoring.json` were written (committed in 49f3192). A container restart then lost
`data/p15/pred/test.t2.ndjson`, `test.naive.ndjson` and the gate's `report.json`, before
`predictions.sha256` and the baselines. The recovery, in order:

```
D=data/p15; T2=experiments/20261101-p4b-models/models/tracker
node packages/classical/dist/cli-naive.js predict --model data/p4/naive-model.json --in $D/test.f32pack \
  --out $D/pred/test.naive.ndjson --per-timestep
node packages/models/dist/cli-predict.js --model $T2 --truth $D/test.f32pack \
  --features $D/test.features.bin --out $D/pred/test.t2.ndjson --train $D/train.f32pack
# must equal the input digest in test.fused-ekf.ndjson's header (4b85873b…): it does
echo "4b85873bb846cf0af49e156f962939f2ecd43bbac470abb2a8bf8cc15fab1cee  $D/pred/test.t2.ndjson" | sha256sum -c -
# then run.sh's steps after the gate: predictions.sha256, spec019-baselines.mjs, spec014-lsq.mjs
node --max-old-space-size=12288 packages/eval/dist/cli-g5.js --truth $D/test.f32pack \
  --tracker $D/pred/test.fused-ekf.ndjson --reference $D/pred/test.ekf.ndjson \
  --also $D/pred/test.imm.ndjson --also $D/pred/test.fused-imm.ndjson --also $D/pred/test.t2.ndjson \
  --decision experiments/20261116-p15-decision/decision.json --plan configs/phase4/x/plan.json \
  --model $T2 --experiment experiments/20261116-p15-g5-r --repeat-of experiments/20261116-p15-g5
cp experiments/20261116-p15-g5-r/report.json experiments/20261116-p15-g5/report.json
```

This folder's `verdict.json` and `report.json` are byte-identical to the gate folder's;
`scoring.json` differs only by `repeat_of`.
