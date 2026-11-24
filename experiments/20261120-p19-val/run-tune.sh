#!/bin/bash
# Phase 19, step 1 (spec 032, SRD Annex J §J.2): tune the EKF and IMM smoothers on seed 217's
# validation split (phase 17's file, hash-checked), independently of the time-late network.
set -e
cd "$(git rev-parse --show-toplevel)"
P=data/p17val; E=experiments/20261120-p19-val
echo "cdceee4f32c92d16eec9b35a99483e1bd17234f92e10c18c3a7274aa222ac2c1  $P/validation.f32pack" | sha256sum -c -
node --max-old-space-size=12288 scripts/research/spec032-tune.mjs $P/validation.f32pack \
  configs/phase19/smoother-grid.json > $E/tune.json
