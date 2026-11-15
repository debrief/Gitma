#!/bin/bash
# Spec 025 §D.7 validation: the re-armed composite's grid on seed 217's validation split with
# realistic bearing error. Uses least squares and the fused tracker from
# experiments/20261115-p12-val (data/p11val/real/pred; hashes in that experiment's inputs.sha256).
# Committed before any variant is scored.
set -e
cd "$(git rev-parse --show-toplevel)"
D=data/p11val/real; E=experiments/20261115-p12b-val
node --max-old-space-size=12288 scripts/research/spec025-rearm-grid.mjs $D/validation.f32pack \
  $D/pred/lsq.ndjson $D/pred/fused-t2.ndjson $E/grid.json
( cd $D && sha256sum validation.f32pack pred/lsq.ndjson pred/fused-t2.ndjson ) > $E/inputs.sha256
