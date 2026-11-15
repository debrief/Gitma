#!/bin/bash
# Spec 024 (research, no gate): Cramér–Rao bounds at the G5 rows of seed 217's validation split,
# realistic error and its clean twin, beside every estimator on the same rows. Uses the data and
# predictions of experiments/20261114-p11-val/run.sh (data/p11val; hashes in that experiment's
# predictions.sha256). Committed before it is run.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p11val; E=experiments/20261115-crb
for v in real clean; do
  M=configs/phase7-ranges.json; [ $v = clean ] && M=--clean
  node --max-old-space-size=8192 scripts/research/spec024-crb.mjs $D/$v/validation.f32pack $M $E/crb-$v.json \
    t2=$D/$v/pred/t2.ndjson t2re=$D/$v/pred/t2re.ndjson imm=$D/$v/pred/imm.ndjson \
    ekf=$D/$v/pred/ekf.ndjson fused=$D/$v/pred/fused-t2.ndjson naive=$D/$v/pred/naive.ndjson
done
( cd $D && sha256sum real/validation.f32pack clean/validation.f32pack real/pred/{t2,t2re,imm,ekf,fused-t2,naive}.ndjson \
  clean/pred/{t2,t2re,imm,ekf,fused-t2,naive}.ndjson ) > $E/inputs.sha256
