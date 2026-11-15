#!/bin/bash
# Spec 025 validation (SRD Annex D §D.2): the composite solver's fit-check grid on seed 217's
# validation split with realistic bearing error, against the frozen -g1 fused tracker. Uses the
# data and fused predictions of experiments/20261114-p11-val/run.sh (data/p11val; hashes in that
# experiment's predictions.sha256). Least squares at every timestep is computed here. Committed
# before any variant is scored.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p11val/real; E=experiments/20261115-p12-val
node packages/classical/dist/cli-solve.js --in $D/validation.f32pack --out $D/pred/lsq.ndjson \
  --per-timestep --workers 4
node --max-old-space-size=12288 scripts/research/spec025-grid.mjs $D/validation.f32pack \
  $D/pred/lsq.ndjson $D/pred/fused-t2.ndjson $E/grid.json
( cd $D && sha256sum validation.f32pack pred/lsq.ndjson pred/fused-t2.ndjson ) > $E/inputs.sha256
