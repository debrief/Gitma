---
description: "Task list for 003 — Iteration 2, is the solution useful under noise (G2)"
---

# Tasks: Iteration 2 — Is the Solution Useful Under Noise? (Gate G2)

**Input**: Design documents from `/specs/003-iteration-2-noise/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md;
**G1 `pass` decided by the agent panel** (nothing below merges before it).

**Tests**: included and written first (constitution II golden tests; spec independent tests).
Tasks marked **[USER]** depend on a pending user decision; **[G1-dependent]** on the G1 outcome.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 0: Preconditions

- [x] T001 Record G1 outcome and G1-dependent inputs in `research.md` (carried configuration per variant, whether T033 of spec 002 implemented bootstrap CIs, merged form of `train.yml`, G1 panel findings affecting checks or tolerances) **[G1-dependent]**
- [x] T002 Record the user's answers to plan.md "Open questions" 1–7 in `spec.md` Assumptions and `research.md`; drop US6 tasks if the turn is deferred **[USER]**

## Phase 1: Setup

- [x] T003 Schema 0.8.0 (was 0.5.0; iteration 1 used 0.5.0–0.7.0) in `schema/tma.yaml` per data-model.md (provenance, turn slots, `FeatureSet`, `NormalisationConstants.bearing_rate_scale_rad_s`, `TrainingConfig.feature_set`, `ModelManifest` lineage slots, `GateResult.inconclusive`, `GateCheck` CI slots, `MetricsRecord` window-position slots, `PairedComparison`, `ChangeDecision`); `pnpm schema:gen`; data dictionary regenerates
- [x] T004 [P] `configs/iter2-ranges.json`, `configs/iter2-heldout-ranges.json` (σ ∈ {1°, 2°}, dropout 0–0.10; the turn rate is added with T017 so no config asks for a turn the generator cannot yet draw) and, if US6, `configs/iter2-turn-only-test-ranges.json`
- [ ] T005 (preliminary done 2026-10-11: speed threshold unmet by classical at zig+300 s, see R12; re-run on final generator) Achievability reference (research R12): naive + classical per-timestep on a seed-201 test split; record classical σ = 1° medians at zig + 300 s against G2 thresholds in `research.md`; tell the user before any training

---

## Phase 2: User Story 1 — Trustworthy data lineage (P1) → PR A

### Tests ⚠️

- [x] T006 [P] [US1] Header provenance: clean tree → commit + `dirty: false`; dirty tree → refusal without `--allow-dirty`, `dirty: true` with it; outside git → refusal, in `packages/data/test/provenance.test.ts`
- [x] T007 [P] [US1] Features format v2 round-trip: source header and digest embedded; v1 files still read, in `packages/features/test/features-file.test.ts`
- [x] T008 [P] [US1] Lineage refusals `lineage-missing`, `lineage-dirty`, `lineage-mismatch` (generator paths differ from G0 commit, injected diff function), `lineage-split-mismatch`, `feature-set-mismatch`, in `packages/models/test/lineage.test.ts`

### Implementation

- [x] T009 [US1] Git provenance capture (commit, dirty; runs in the package checkout) in `packages/data/src/provenance.ts`; reuse from the eval manifest code
- [x] T010 [US1] Header provenance and `--allow-dirty` in `packages/data/src/generate.ts`, `cli-generate.ts`
- [x] T011 [US1] Features format v2 writer/reader in `packages/features/src/features-file.ts`, `reader.ts`
- [x] T012 [US1] Lineage checks in `packages/models/src/lineage.ts`; call from `cli-train.ts`; record `source_dataset_header`, `g0_experiment` in the manifest
- [x] T013 [US1] Update data and features goldens (`UPDATE_GOLDEN=1`), stating in the PR: header provenance slots (data), format v2 (features)

## Phase 3: User Story 6 — Rate-limited ownship turn (P2) **[USER]** → PR A

### Tests ⚠️

- [x] T014 [P] [US6] Known answers: 90° at 1°/s, 5 m/s from (0, 0) heading north ends at (r, r) with r = v/ω and course 90°; mid-turn sample on the arc; negative zig mirrors; in `packages/sim/test/turn.test.ts`
- [x] T015 [P] [US6] Invariants: t = 0 bearing/range equal drawn parameters; `zig_index` is the first sample after the turn completes; `turn_start_index` ≤ `zig_index`; absent turn rate reproduces 0.1.0 trajectories exactly, in `packages/sim/test/scenario.test.ts`
- [x] T016 [P] [US6] G0 `independent-geometry` in-turn case (literal `Math.atan2`, closed-form arc), in `packages/eval/test/g0-checks.test.ts`

### Implementation

- [x] T017 [US6] Constant-rate turn in `packages/sim/src/scenario.ts` (closed-form arc, float32, redraw if the turn does not complete); `GENERATOR_VERSION` 0.2.0; sim golden updated with reason
- [x] T018 [US6] In-turn case in `packages/eval/src/g0-checks.ts`

**Checkpoint (PR A)**: lint, typecheck, tests, schema:check, site:build green; generator algorithm page updated (T047). **Merge only after G1 is final** (plan: critical notes).

## Phase 4: G0 re-run (after PR A merges)

- [ ] T019 `tma-g0` at PR A's merge commit (quickstart §1) → `experiments/<date>-g0-i2/`
- [ ] T020 Agent review panel (five reviewers) on the G0 re-run; fix/answer findings; `review.md`; `decided_by` set → PR

**Checkpoint**: training guard and lineage accept seed-201 data generated at a commit whose generator paths equal the G0 commit's.

---

## Phase 5: User Story 4 — Evaluation for G2 (P1) → PR B (parallel with Phases 2–4)

### Tests ⚠️

- [ ] T021 [P] [US4] Dropout bands: scenario with `dropout_fraction` 0.03 → `dropout_band=0-5pct`, 0.07 → `5-10pct`; boundary 0.05 → upper band, in `packages/eval/test/slices.test.ts`
- [ ] T022 [P] [US4] Window-mean position: hand-computed per-scenario means, median/P90 over scenarios; non-converged rows excluded from the mean and counted, in `packages/eval/test/evaluate.test.ts`
- [ ] T023 [P] [US4] Bootstrap: same seed ⇒ identical CIs; CI contains the true median in ≈ 95% of 200 synthetic draws (tolerance band); paired variant for ratios, in `packages/eval/test/bootstrap.test.ts`
- [ ] T024 [P] [US4] Common-row comparison: rows where either estimator is non-converged or non-finite excluded; coverage per estimator correct, in `packages/eval/test/compare.test.ts`
- [ ] T025 [P] [US4] G2 gate: pass (CI clear below), inconclusive (CI straddles), fail (point above) for each of range/course/speed; sample mismatch with naive ⇒ fail; verdict aggregation pass/fail/inconclusive; repeated G1 checks present, in `packages/eval/test/gate-g2.test.ts`

### Implementation

- [ ] T026 [US4] `dropout_band` slice in `packages/eval/src/slices.ts`
- [ ] T027 [US4] Window-mean position slots in `packages/eval/src/evaluate.ts`
- [ ] T028 [US4] Extend `packages/eval/src/bootstrap.ts` (paired median ratio built in spec 002) with a seeded percentile interval on a single median; `--bootstrap`, `--bootstrap-seed` in `cli-eval.ts`
- [ ] T029 [US4] Common-row comparison in `packages/eval/src/compare.ts`; `--compare-to` in `cli-eval.ts`
- [ ] T030 [US4] G2 checks in `packages/eval/src/gate-g2.ts` (reusing `gate-g1.ts` checks); `tma-gate g2` in `cli-gate.ts`; exit 3 on fail or inconclusive (as PR #21)
- [ ] T031 [US4] Update eval goldens with reason (new slices and optional slots)

---

## Phase 6: User Stories 2 + 3 — Derived features and training plumbing (P1) → PR C

### Tests ⚠️

- [ ] T032 [P] [US3] Derived features: known values (constant bearing rate ⇒ exact slope; intercept for a hand case); causality by perturbing rows > t; zero on dropout and padding rows; `rate_valid` = 0 with < 3 valid samples; wrap across 0/2π, in `packages/features/test/derived.test.ts`
- [ ] T033 [P] [US3] Inputs-only and counterfactual: `bearing_rate_scale_rad_s` unchanged when target truth is scrambled; derived inputs byte-identical under scrambled truth, in `packages/features/test/normalise.test.ts`
- [ ] T034 [P] [US2] Model input width follows the features file layout (10 or 13); a model trained on `raw` refuses `derived` files at predict time, in `packages/models/test/architectures.test.ts`, `predict.test.ts`
- [ ] T035 [P] [US2] Features golden for the `derived` set (fixed seed, byte-identical), in `packages/features/test/golden.test.ts`

### Implementation

- [ ] T036 [US3] `packages/features/src/derived.ts` (pure functions); feature sets in `layout.ts`; `--feature-set` in `cli.ts`; scale constant in `normalise.ts`
- [ ] T037 [US2] Input width from layout in `packages/models/src/architectures.ts`, `batches.ts`, `predict.ts`
- [ ] T038 [US2] `tma-g2` one-command run (`--split validation|test`, `--compare-models`, `--decision` required for test when phase B exists) in `packages/models/src/g2.ts`, `cli-g2.ts`
- [ ] T039 [P] [US2] Phase A configs `configs/iter2/a/*.json` from the G1-carried configurations with decision 9's budget (`max_epochs` 60, `max_wall_s` 172,800, `length_bucketing` true, `tfjs_threads` 1) and `plan.json` with expected data digests
- [ ] T040 [P] [US2] Generalise `.github/workflows/train.yml` (on main since #33) to plan files; up to three chained 345-min jobs per model resuming from the checkpoint branch (decision 9); evaluation job runs the plan's `evaluate`; pushes `results/<plan>-<run id>`
- [ ] T041 [US2] CI end-to-end on a tiny plan (300 scenarios, 1 epoch, both feature sets) in `.github/workflows/ci.yml`

---

## Phase 7: The runs (after T020, PR B and PR C)

- [ ] T042 [US2] Push `train/i2a`; phase A trains five models; evaluation on validation → `experiments/<date>-i2a-val/` (no test-split metrics)
- [ ] T043 [US3] Decision record `decision.{md,json}` (stalled?, single change, validation evidence, carried-set rule); commit **before** any phase-B run (SC-005)
- [ ] T044 [US3] If stalled: phase B configs `configs/iter2/b/` (`feature_set: derived` or the recorded change); push `train/i2b`; validation → `experiments/<date>-i2b-val/`; record carried set per the rule
- [ ] T045 [US4] G2 on test (`tma-g2 --split test --decision …`) → `experiments/<date>-g2/` (verdict, metrics, curves, bootstrap, comparison, held-out, manifests, weights, logs); if US6, score G1 models on the turn-only diagnostic set into `turn-only/` (reported)
- [ ] T046 [US5] Agent review panel on the G2 evidence; fix/answer findings; re-invite until no reject and no open blocker/major; `review.md`; `decided_by`

---

## Phase 8: User Story 5 — Public report (P2) → PR E (start on CI-sized experiments)

- [x] T047 [P] [US5] `site/docs/algorithms/generator.md` (provenance; rate-limited turn if US6) — lands with PR A
- [ ] T048 [P] [US5] `site/docs/algorithms/feature-layout.md` (derived set, formulae, causality, format v2) — lands with PR C
- [ ] T049 [P] [US5] `site/docs/evaluation.md` (G2, bootstrap CIs, inconclusive, dropout slice, common-row comparison, window-mean position) — lands with PR B
- [ ] T050 [P] [US5] Glossary: bearing rate, bearing-line intercept, pseudo-linear measurement, dropout, confidence interval, inconclusive, rate-limited turn, provenance
- [ ] T051 [US5] `ResultsReview.jsx` slice selector (σ, dropout band) and CI column; `site/docs/results/iteration-2.mdx`
- [ ] T052 [US5] Blog post `site/blog/<date>-iteration-2.md` with G2 figures and CIs beside naive and classical, the change round and the panel decision; welcome page shows G2 from the verdict

## Phase 9: Polish

- [ ] T053 [P] Update `AGENTS.md` (provenance rule, `--allow-dirty`, feature sets, `tma-g2`, iteration-2 gotchas)
- [ ] T054 Adversarial review: what G2 cannot detect (e.g. a pass carried by short ranges, which log-uniform sampling makes common, while 10–20 km fails; scenarios excluded at zig + 300 s); record in the blog post

---

## Coverage

| Requirement | Tasks |
| --- | --- |
| FR-001–004 provenance | T006–T013, T019–T020 |
| FR-005 data | T004, T042 |
| FR-006 turn **[USER]** | T014–T018 |
| FR-007, FR-010, FR-011 phase A, cap, CI training | T039–T042 |
| FR-008, FR-009 change round, derived features | T032–T036, T043–T044 |
| FR-012 validation-only selection | T038, T043–T045 |
| FR-013 dropout slice | T021, T026 |
| FR-014–016 G2, CIs, repeated checks | T023, T025, T028, T030 |
| FR-017 common-row comparison | T024, T029 |
| FR-018 window-mean position | T022, T027 |
| FR-019 held-out | T045 |
| FR-020–021 experiment, panel | T045–T046 |
| FR-022 site | T047–T052 |
| SC-001–006 | T008; T041–T042; T045–T046; T042/T044 (shuffled); T043; T051–T052 |

## Dependencies & Execution Order

- T001–T002 first (G1 and user decisions). T003 before every code task. T005 any time after T004.
- PR A (Phases 2–3) → merge only after G1 is final → Phase 4 (G0 re-run + panel).
- PR B (Phase 5) and PR C (Phase 6) are independent of PR A and of each other except T038 needs
  T030; both can be developed while Phase 4 runs.
- Phase 7 needs Phase 4, PR B and PR C. T043 strictly before T044 and before any test-split scoring.
- Site pages land with the PR that introduces their concept (T047–T049); T051–T052 after T046.

## Implementation Strategy (PR grouping)

1. **PR A**: schema 0.5.0 + provenance + lineage (+ turn if confirmed) + generator page.
2. **PR (G0 re-run)**: `experiments/<date>-g0-i2/` with panel `review.md`.
3. **PR B**: evaluation additions and G2 gate + evaluation page.
4. **PR C**: derived features, `tma-g2`, configs, generalised `train.yml` + feature-layout page.
5. Runs on `train/i2a` (and `train/i2b`) → **PR D**: validation experiments, decision record, G2
   experiment, panel review.
6. **PR E**: results page, blog, glossary, AGENTS.md (may merge with PR D).
