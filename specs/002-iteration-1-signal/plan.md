# Implementation Plan: Iteration 1 — Is the Signal Learnable? (Gate G1)

**Branch**: `002-iteration-1-signal` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-iteration-1-signal/spec.md`

## Summary

Add a `packages/models` package that trains four small Keras-equivalent tfjs-node models (causal
LSTM, BiLSTM, causal 1-D CNN control, MLP control) on the iteration-0 feature files, streamed in
seeded batches with a 6-hour wall-clock cap per model. Models are deterministic from a manifest and
emit predictions in the existing format, so the iteration-0 evaluation scores them beside naive and
classical unchanged. A new `tma-gate g1` judges G1 plus consistency, control and shuffled-label
leakage checks. The site gets a results-review page and per-PR previews on `gh-pages/pr/<N>/`.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22.22 (pinned), ESM.

**Primary Dependencies**: `@tensorflow/tfjs-node` 4.22.0 (new, `packages/models` only); existing
workspace packages; Docusaurus 3.10 for the site.

**Storage**: dataset and feature files under `data/` (not committed); trained models in tfjs layers
format (`model.json` + `weights.bin`, ≤ 4 MB each), committed inside the G1 experiment folder.

**Testing**: vitest. Model tests use tiny configs (≤ 64 scenarios, ≤ 2 epochs) so CI stays fast:
shapes, causality by perturbation, determinism (weights hash), loss masking, prediction conversion,
G1 gate logic on synthetic metrics.

**Target Platform**: Linux x64 container, 4 cores, no GPU (training reference); CI ubuntu-latest for
tests only, never full training.

**Project Type**: monorepo of libraries + CLIs, plus static site.

**Performance Goals**: ≥ 150 windows/s LSTM and ≥ 80 windows/s BiLSTM at batch 256 (spike: 200/100).

**Constraints**: ≤ 6 h wall-clock per model (relaxed SRD §4, recorded); deterministic weights on the
pinned runtime and CPU family; Keras-equivalent layers only.

**Scale/Scope**: 10^5 scenarios (8×10^4 train), 4 models + 1 shuffled-label run, ≤ 4 configurations
per model.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
| --- | --- | --- |
| I. Single source of types | `ModelKind`, `TrainingConfig`, `EpochRecord`, `ModelManifest` added to `schema/tma.yaml` (0.3.0) | ✅ |
| II. Determinism | Seeded initializers, PRNG batch order, `trainOnBatch`; golden weights hash on a tiny config | ✅ with note: weights identical on the same CPU family only (research R2) |
| III. Portability | Only Masking, LSTM, Bidirectional, Conv1D, Dense, TimeDistributed, Flatten, Reshape, ZeroPadding2D; hyperparameters in `TrainingConfig` | ✅ (causal padding built from Keras layers, R3) |
| IV. Honest measurement | Models scored by the unchanged iteration-0 harness beside naive + classical; shuffled-label test; controls | ✅ |
| V. Fail fast | `tma-train` refuses without a G0 pass; G1 verdict with all checks; ≤ 4 configs per model | ✅ |
| Technical constraints | tfjs-node for training (SRD §6) | ✅ |
| SRD §4 "under an hour" | Relaxed to 6 h by user decision | ⚠️ documented deviation; SRD amendment proposed |

**Post-design re-check**: no constitution violations. The only deviation is from the SRD's time
budget, recorded in spec, research R1 and the PR.

## Project Structure

### Documentation (this feature)

```text
specs/002-iteration-1-signal/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/cli.md
└── tasks.md   # /speckit-tasks
```

### Source Code (repository root)

```text
schema/tma.yaml                       # + ModelKind, TrainingConfig, EpochRecord, ModelManifest (0.3.0)
configs/
├── iter1-ranges.json                 # σ = 0.5° only, no dropouts
└── iter1/{instantaneous,time-late,causal-cnn,mlp,instantaneous-shuffled}.json
packages/models/                      # NEW
├── src/
│   ├── architectures.ts              # four builders (R4), seeded initializers
│   ├── loss.ts                       # masked weighted loss (R5)
│   ├── batches.ts                    # random-access feature reader, seeded epoch order (R6)
│   ├── train.ts                      # loop: trainOnBatch, validation, early stop, wall-clock cap
│   ├── manifest.ts                   # ModelManifest, digests, environment capture
│   ├── predict.ts                    # outputs → Prediction rows (R7)
│   ├── g0-guard.ts                   # refuse training without a G0 pass
│   ├── cli-train.ts  cli-predict.ts
│   └── index.ts
└── test/                             # tiny-config tests incl. causality, determinism, golden hash
packages/features/src/reader.ts       # random-access .features.bin reader (shared)
packages/eval/src/
├── gate-g1.ts  cli-gate.ts (g1)      # G1 + consistency/control/leakage checks (R8)
└── g1.ts  cli-g1.ts                  # one-command run
site/
├── src/components/ResultsReview.jsx  # SVG curves + sliced table from experiment files (R9)
├── docs/results/iteration-1.mdx
├── docs/algorithms/models.md
└── blog/<date>-iteration-1.md
.github/workflows/
├── pr-preview.yml                    # build with SITE_BASE_URL=/Gitma/pr/<N>/, publish, comment
└── pr-preview-cleanup.yml            # remove /pr/<N>/ on close
```

**Structure Decision**: one new package (`models`) so tfjs-node, a large native dependency, stays out
of every other package and out of CI jobs that don't need it. Results review lives in the site
rather than a separate `demos` package until a demo needs in-browser inference.

## Phasing (input to /speckit-tasks)

1. **Setup**: `packages/models` scaffold with tfjs-node; schema 0.3.0; iteration-1 configs.
2. **Foundation**: random-access feature reader; seeded batch order; masked loss; G0 guard.
3. **US1** architectures + training loop + manifest; determinism and causality tests (P1).
4. **US2** predictions; `tma-gate g1`; `tma-g1` one-command run (P1).
5. **US3** controls wired into checks; consistency checks (P2).
6. **US4** shuffled-label run and leakage check (P2).
7. **Run**: generate data, train five models (≈ 10–15 h total, background), evaluate, commit
   `experiments/<date>-g1/` — only after the team accepts G0.
8. **US5** results review page, models algorithm note, blog post, PR preview workflows (P3).

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| 6 h per-model budget vs SRD's 1 h | 1 h allows only ≈ 4 BiLSTM epochs on the reference CPU | Subset training weakens the G1 test; PyTorch port adds a second stack now |

## Critical notes for review

- **Total compute up to ≈ 26 h (5 models × ≤ 6 h, shuffled ≤ 2 h; early stopping usually sooner)** for five models on one container. Sessions are ephemeral, so training
  must be resumable or run as background jobs whose outputs are committed promptly. The plan adds
  checkpointing per epoch (weights + manifest so far) so a restart resumes rather than starts over.
- **Weight reproducibility is per CPU family.** Results (metrics) should be robust to that; the
  golden test pins only a tiny config on the CI machine.
- **The MLP control has the most parameters** (0.93M); if it beats the LSTM, that's informative (the
  sequence structure isn't being exploited), not a bug.
- **Non-causal models train on all window rows** but are scored only after the zig, like everything
  else.
- **G1 is a stop gate.** If it fails, the SRD says stop and write up. The verdict must therefore be
  produced on an honest configuration, with every hyperparameter run recorded.
