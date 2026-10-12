---
description: "Task list for 002 — Iteration 1, is the signal learnable (G1)"
---

# Tasks: Iteration 1 — Is the Signal Learnable? (Gate G1)

**Input**: Design documents from `/specs/002-iteration-1-signal/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included (constitution II golden tests; spec independent tests). Tests use tiny configs.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Scaffold `packages/models` (`package.json` with `@tensorflow/tfjs-node@4.22.0`, `tsconfig.json`, references, root scripts `tma-train`, `tma-model-predict`); add to root `tsconfig.json`, `tsconfig.check.json` paths and `vitest.config.ts` aliases
- [x] T002 Add `ModelKind`, `TrainingConfig`, `EpochRecord`, `ModelManifest` to `schema/tma.yaml`, bump to 0.3.0, `pnpm schema:gen`; update data goldens (version-only change) with stated reason
- [x] T003 [P] `configs/iter1-ranges.json` (σ = 0.5° only, no dropouts) and `configs/iter1/{instantaneous,time-late,causal-cnn,mlp,instantaneous-shuffled}.json` per research R4/R5
- [x] T004 [P] Allow the tfjs-node native build in `pnpm-workspace.yaml` (`onlyBuiltDependencies`) and verify CI install time

## Phase 2: Foundational

- [x] T005 [P] Test: random-access feature reader returns the same tensors as `buildWindow` for scenario k, rejects bad magic/version, in `packages/features/test/reader.test.ts`
- [x] T006 Random-access `.features.bin` reader (header, indices, per-scenario offsets) in `packages/features/src/reader.ts`
- [x] T007 [P] Test: seeded epoch permutation is deterministic and a permutation, in `packages/models/test/batches.test.ts`
- [x] T008 Batch assembler (seeded order via `@tma/sim` PRNG, `y_true` packed as 4 targets + loss weight, optional label shuffling) in `packages/models/src/batches.ts`
- [x] T009 [P] Test: masked loss ignores zero-weight rows and matches a hand computation, in `packages/models/test/loss.test.ts`
- [x] T010 Masked weighted loss (R5) in `packages/models/src/loss.ts`
- [x] T011 [P] Test + implementation: G0 guard (refuses without a G0 pass verdict) in `packages/models/src/g0-guard.ts`, `packages/models/test/g0-guard.test.ts`

**Checkpoint**: data can be streamed in deterministic batches with the correct loss.

---

## Phase 3: User Story 1 — Train both variants reproducibly (P1) 🎯 MVP

### Tests ⚠️

- [x] T012 [P] [US1] Shapes: each architecture maps [B, 240, 10] → [B, 240, 4]; only allowed layer classes used, in `packages/models/test/architectures.test.ts`
- [x] T013 [P] [US1] Causality: perturbing inputs after row t leaves outputs ≤ t unchanged for `instantaneous` and `causal_cnn`, and changes them for `time_late` and `mlp`, in `packages/models/test/causality.test.ts`
- [x] T014 [P] [US1] Determinism golden: 64 scenarios × 2 epochs trained twice → identical weights digest, compared with `packages/models/test/golden/weights-digests.json`, in `packages/models/test/golden.test.ts`
- [x] T015 [P] [US1] Training loop: early stopping, wall-clock cap and NaN divergence each set the right `stop_reason`, in `packages/models/test/train.test.ts`

### Implementation

- [x] T016 [US1] Four builders with seeded initializers and explicit causal padding (R3/R4) in `packages/models/src/architectures.ts`
- [x] T017 [US1] Training loop (`trainOnBatch`, validation per epoch, best-epoch weights, early stop, wall-clock cap, per-epoch checkpoint + resume) in `packages/models/src/train.ts`
- [x] T018 [US1] Manifest (config, digests, normalisation, versions, epochs, environment, weights digest) in `packages/models/src/manifest.ts`
- [x] T019 [US1] `tma-train` CLI per contracts/cli.md in `packages/models/src/cli-train.ts`

**Checkpoint**: a tiny config trains reproducibly; full training can start (after G0 sign-off).

---

## Phase 4: User Story 2 — Score beside baselines and judge G1 (P1)

### Tests ⚠️

- [x] T020 [P] [US2] Prediction conversion: truth-valued outputs give zero error through `rowError`; non-finite outputs give `converged = false`, in `packages/models/test/predict.test.ts`
- [x] T021 [P] [US2] G1 gate: passes when both variants < 0.5 × naive at `zig+300s`, fails when either is not, in `packages/eval/test/gate-g1.test.ts`

### Implementation

- [x] T022 [US2] Model → Prediction rows (R7) in `packages/models/src/predict.ts`; `tma-model-predict` CLI in `packages/models/src/cli-predict.ts`
- [x] T023 [US2] G1 check and verdict assembly in `packages/eval/src/gate-g1.ts`; `tma-gate g1` subcommand in `packages/eval/src/cli-gate.ts`
- [x] T024 [US2] `tma-g1` one-command run (implemented in `packages/models/src/g1.ts` to keep tfjs out of `eval`) (naive + classical per-timestep, model predictions, eval, gate, copy manifests/weights into the experiment; also scores the held-out geometry split into `heldout/` metrics, reported but not gated — FR-014) in `packages/eval/src/g1.ts`, `cli-g1.ts`
- [x] T025 [US2] CI end-to-end on a tiny config: generate 300 scenarios, features, train each model 1 epoch, `tma-g1` runs and writes a verdict (result not asserted), in `.github/workflows/ci.yml`

---

## Phase 5: User Story 3 — Controls and consistency (P2)

- [x] T026 [P] [US3] Tests: consistency check flags a curve point where time-late > 1.05 × instantaneous; control check flags a recurrent model not beating its control, in `packages/eval/test/gate-g1.test.ts`
- [x] T027 [US3] Consistency and control checks in `packages/eval/src/gate-g1.ts`

## Phase 6: User Story 4 — Shuffled-label leakage check (P2)

- [x] T028 [P] [US4] Test: label shuffling permutes targets across scenarios but not inputs; leakage check passes within ±10% of naive and fails outside, in `packages/models/test/batches.test.ts`, `packages/eval/test/gate-g1.test.ts`
- [x] T029 [US4] Leakage check in `packages/eval/src/gate-g1.ts`; `instantaneous-shuffled` config wired into `tma-g1`

---

## Phase 7: The run (after the team accepts G0)

- [ ] T030 Generate iteration-1 data and features (quickstart §1); record digests
- [ ] T031 Train five models in the background with checkpoints (quickstart §2); commit each manifest as it finishes; every configuration tried (≤ 4 per model) is kept and listed in the experiment manifest, not only the best (FR-009)
- [ ] T032 Reproducibility check on a reduced config (quickstart §4)
- [x] T033 `tma-g1` → commit `experiments/<date>-g1/` (verdict, metrics, curves, manifests, weights); report a paired bootstrap 95% CI of each model/naive median ratio at zig+300s and call G1 "inconclusive" if it crosses 0.5 (G0 panel round 2) — implemented: `bootstrap.ts`, `G1Intervals`, `bootstrap.json`, `evaluate-g1.yml` re-scores committed models; run the agent panel on the G1 evidence before the decision; inconclusive → the panel may order one larger fresh-seed test set, still inconclusive → fail (user, 2026-10-11) — **done (2026-10-12)**: attempt 1 `experiments/20261011-g1-r2/` (panel rounds 1–2: fail as run), attempt 2 `experiments/20261012-g1-r2/` (re-score run 38275763335; both intervals wholly below 0.5; machine verdict inconclusive from `time-late-not-worse`); panel round 3 passed G1 under pre-registered rule 1, record in its `review.md`

---

## Phase 8: User Story 5 — Public report and previews (P3)

- [x] T034 [P] [US5] Results review component (SVG error-vs-time curves, sliced table) in `site/src/components/ResultsReview.jsx`; page `site/docs/results/iteration-1.mdx`
- [x] T035 [P] [US5] Algorithm note `site/docs/algorithms/models.md` (four architectures, loss, masking, causal padding workaround); glossary terms (control, shuffled-label test, time-late/instantaneous already present)
- [x] T036 [P] [US5] `.github/workflows/pr-preview.yml` and `pr-preview-cleanup.yml` (same-repo PRs; comment with link)
- [x] T037 [US5] Blog post with G1 numbers, all checks and the team's decision, `site/blog/<date>-iteration-1.md`; welcome page shows G1 from the verdict — **done (2026-10-12)**: `site/blog/2026-10-12-iteration-1.md` (published) carries both attempts (every check, intervals, slices with n, held-out split, every run and job per FR-009), panel rounds 1–3, the decision (G1 passed, panel round 3, with the caveat) and iteration-2 leads. Results page shows `20261012-g1-r2` with the panel decision and lists `20261011-g1-r2` as an earlier attempt; welcome page shows G1 from the verdict.

## Phase 9: Polish

- [x] T038 [P] Update `AGENTS.md` and README (models package, training commands, budget, G1 status)
- [ ] T039 [P] Propose SRD amendment for the 6 h budget (PR #18) (separate PR against `docs/SRD.md`)
- [x] T040 Adversarial review of G1: confirm a model given truth as input would be caught by the leakage check only if inputs leak, and record what G1 cannot detect (`g1-limits.md`; panel briefs in `g1-panel-briefs.md`)

---

## Coverage (speckit-analyze, 2026-10-11)

All 17 FRs and 6 SCs map to tasks. Two gaps found and closed in this file: FR-014 (held-out split
scoring → T024) and FR-009 (all runs recorded → T031). No constitution conflicts; the SRD §4 time
budget deviation is tracked by T039.

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2; US3 and US4 extend US2's gate (can proceed in parallel).
- Phase 7 (the run) needs US1–US4 and the team's acceptance of G0.
- US5 can start once Phase 4 exists (with synthetic data), finishes after Phase 7.

## Implementation Strategy

1. PR A: Setup + Foundational + US1 (training reproducible on tiny configs).
2. PR B: US2–US4 (predictions, G1 gate with all checks, CI e2e on tiny data).
3. PR C: US5 previews and results page (on synthetic/CI experiment).
4. The run (≈ 10–15 h background) → PR D with `experiments/<date>-g1/`, blog post and decision.
