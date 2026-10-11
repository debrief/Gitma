---
description: "Task list for 001 — Iteration 0 verified experiment pipeline (G0)"
---

# Tasks: Iteration 0 — Verified Experiment Pipeline (Gate G0)

**Input**: Design documents from `/specs/001-iteration-0-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Constitution II requires a golden-file test per package, and the spec defines an
independent test per story. Write each story's tests first and confirm they fail.

**Organization**: by user story (spec priorities). US1 and US2 are both P1; US2 depends on US1's
generator. US3 and US4 (P2) are independent of each other.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from spec.md
- Paths are repository-relative (layout in plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: monorepo, toolchain and CI skeleton

- [x] T001 Create root `package.json` (private, `"type": "module"`, `engines.node` 22), `pnpm-workspace.yaml` (`packages/*`, `site`), `.nvmrc` (pinned 22.x), extend `.gitignore` with `data/`, `dist/`, `node_modules/`
- [x] T002 Create `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2023, NodeNext) and root `tsconfig.json` with project references for all packages
- [x] T003 [P] Configure ESLint flat config in `eslint.config.js` (typescript-eslint strict-type-checked; `no-explicit-any` error except `packages/types/generated/**`; ban `Math.random` via `no-restricted-properties`)
- [x] T004 [P] Configure Prettier in `.prettierrc.json` and `.prettierignore` (ignore generated code, golden files)
- [x] T005 [P] Configure vitest workspace in `vitest.workspace.ts`
- [x] T006 [P] Create `pyproject.toml` + `uv.lock` pinning `linkml==1.12.*` as a dev dependency
- [x] T007 Scaffold packages `types`, `sim`, `data`, `features`, `classical`, `eval` under `packages/<name>/` each with `package.json` (`@tma/<name>`), `tsconfig.json`, `src/index.ts`, `test/`
- [ ] T008 (partial: build/lint/typecheck/test/schema scripts done; CLI scripts land with their stories) Add root scripts in `package.json`: `build`, `lint`, `typecheck`, `test`, `test:golden`, `schema:gen`, `schema:check`, `site:build`, `site:start`, and one script per CLI (`tma-generate`, `tma-convert`, `tma-features`, `tma-naive`, `tma-solve`, `tma-eval`, `tma-gate`, `tma-g0`)
- [x] T009 Create `.github/workflows/ci.yml`: setup Node from `.nvmrc`, pnpm, uv; run lint, typecheck, test, `schema:check`; later steps (golden, e2e, site) added by their stories

**Checkpoint**: `pnpm install && pnpm build && pnpm lint && pnpm test` pass on an empty workspace in CI.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema-generated types and the PRNG that every story depends on

**⚠️ CRITICAL**: no user story work can begin until this phase is complete

- [x] T010 Spike (research R1): confirm `json-schema-to-zod` handles `$defs`, enums, nullable arrays and nested classes from LinkML `gen-json-schema` output; record result in `specs/001-iteration-0-pipeline/research.md` R1 follow-up
- [x] T011 Write `schema/tma.yaml` with every class in data-model.md (ScenarioParameters, ParameterRanges, PlatformState, Track, Observation, ScenarioMetadata, Scenario, DatasetHeader, NormalisationConstants, FeatureLayout description, Prediction, PredictionRow, MetricsRecord, ExperimentManifest, GateVerdict, GateCheck), with descriptions, units and ranges; slot names follow Stone Soup `GroundTruthState`/`GroundTruthPath`/`Detection` where sensible and each class description names its Stone Soup analogue (FR-009)
- [x] T012 Implement `packages/types/scripts/generate.ts`: `uv run gen-json-schema` → `packages/types/generated/tma.schema.json` → zod → `packages/types/generated/zod.ts`; export `z.infer` types from `packages/types/src/index.ts` (fallback to in-repo JSON-Schema→zod emitter if T010 fails)
- [x] T013 Implement `schema:check` in `packages/types/scripts/check.ts`: regenerate to temp dir, diff against committed `generated/`, exit non-zero if stale
- [x] T014 [P] Add `SCHEMA_VERSION` constant generated from `schema/tma.yaml` `version` into `packages/types/generated/version.ts`
- [x] T015 [P] Known-answer tests for SplitMix64 and xoshiro128** (published reference vectors) in `packages/sim/test/unit/prng.test.ts`
- [x] T016 Implement SplitMix64 seeding, xoshiro128**, `uniform`, `logUniform`, `gaussian` (Box–Muller, single value) and `deriveSeed(datasetSeed, index)` in `packages/sim/src/prng.ts`
- [x] T017 [P] Tests for angle helpers (wrap to [0, 2π), wrapped difference, bearing from (dx, dy) clockwise from north, 359°/1° cases) in `packages/sim/test/unit/geometry.test.ts`
- [x] T018 [P] Implement angle helpers and unit conversions (kt↔m/s, deg↔rad, `f32 = Math.fround`) in `packages/sim/src/geometry.ts`
- [x] T019 [P] Shared file-reading helper that validates with generated zod schemas and reports `file:record: message` in `packages/types/src/read.ts`

**Checkpoint**: types generated and checked in CI; PRNG and geometry pass known-answer tests.

---

## Phase 3: User Story 1 — Generate reproducible scenario datasets (Priority: P1) 🎯 MVP

**Goal**: seed + ranges in → split NDJSON and `.f32pack` datasets out, byte-identical on re-run.

**Independent Test**: generate twice from one seed and `diff`; inspect one scenario by hand; round-trip check.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [x] T020 [P] [US1] Hand-computed known-answer geometry tests (independent of the solver; plan "G0 is necessary, not sufficient"): target dead ahead closing → constant bearing; target abeam stationary → bearing rate sign; ownship zig changes ownship course by exactly the drawn angle — in `packages/sim/test/unit/known-answer.test.ts`
- [x] T021 [P] [US1] Property tests over 1,000 seeds (samples 60–240, zig index in 40–60%, target constant velocity, ranges > 100 m, dropout count ≤ fraction, all floats are float32) in `packages/sim/test/unit/invariants.test.ts`
- [x] T022 [P] [US1] Golden test: seed 1, 20 scenarios → byte-compare NDJSON and `.f32pack` with `packages/data/test/golden/` in `packages/data/test/golden.test.ts`
- [x] T023 [P] [US1] Round-trip test NDJSON ↔ `.f32pack`, version-mismatch rejection, and truncated/corrupted file tests (both formats fail naming file and record) in `packages/data/test/roundtrip.test.ts`
- [x] T080 [P] [US1] Golden test for `packages/sim`: seed 1, 20 scenarios → byte-compare canonical JSON of `generateScenario` output with `packages/sim/test/golden/` in `packages/sim/test/golden.test.ts`
- [x] T024 [P] [US1] Throughput test: ≥ 1,000 scenarios/s single thread (skipped below a CPU-speed floor in CI, always run in `pnpm bench`) in `packages/data/test/throughput.test.ts`

### Implementation for User Story 1

- [x] T025 [P] [US1] Default and held-out `ParameterRanges` in `packages/sim/src/ranges.ts`
- [x] T026 [US1] Parameter draw from ranges (log-uniform range, ±zig sign, σ set, dropout fraction; redraw if min range < 100 m; count reported as `DatasetHeader.redraw_count`) in `packages/sim/src/scenario.ts`
- [x] T027 [US1] Ownship two-leg motion and constant-velocity target motion as pure functions over `Float64Array` in `packages/sim/src/motion.ts`
- [x] T028 [US1] Bearing observer (true bearing, Gaussian noise, dropouts, float32 rounding of every stored value) in `packages/sim/src/observer.ts`
- [x] T029 [US1] `generateScenario(datasetSeed, index, ranges): Scenario` composing T026–T028, computing metadata (zig time/index, mean/min range) in `packages/sim/src/scenario.ts`
- [x] T030 [P] [US1] NDJSON writer/reader per contracts/file-formats.md (header line, schema key order, shortest float strings, seed as string) in `packages/data/src/ndjson.ts`
- [x] T031 [P] [US1] `.f32pack` writer/reader per contracts/file-formats.md (magic, offsets table, padded JSON blocks, Float32 arrays) in `packages/data/src/f32pack.ts`
- [x] T032 [US1] Splits (80/10/10 by index, held-out = count/10 from held-out ranges) in `packages/data/src/splits.ts`
- [x] T033 [US1] `tma-generate` CLI (`parseArgs`, atomic writes, JSON summary, exit codes per contracts/cli.md, `--noise-free`) in `packages/data/src/cli-generate.ts`
- [x] T034 [US1] `tma-convert` CLI with `--check` in `packages/data/src/cli-convert.ts`
- [x] T035 [US1] Generate and commit golden files for T022 and T080 via `packages/data/scripts/update-golden.ts`; add `test:golden` step to `.github/workflows/ci.yml`

**Checkpoint**: quickstart §2 passes. Generator usable on its own.

---

## Phase 4: User Story 2 — Verify the generator with a classical solver (Priority: P1)

**Goal**: LM-damped Gauss–Newton solver recovering noise-free truth; per-timestep mode.

**Independent Test**: noise-free dataset → 100% within SC-001 tolerance; σ = 1° → errors grow, never silent failure.

### Tests for User Story 2 ⚠️

- [x] T036 [P] [US2] Noise-free recovery test over 500 scenarios (SC-001 tolerances) in `packages/classical/test/lsq-noise-free.test.ts`
- [x] T037 [P] [US2] Noisy behaviour test: every scenario returns estimate or `converged=false`; median error increases with σ in `packages/classical/test/lsq-noisy.test.ts`
- [x] T038 [P] [US2] Per-timestep test: estimates at each post-zig step use only bearings ≤ t (assert by perturbing future bearings and checking earlier rows unchanged) in `packages/classical/test/lsq-causal.test.ts`
- [x] T039 [P] [US2] Golden test: seed 1, 20 scenarios → byte-compare predictions in `packages/classical/test/golden.test.ts`

### Implementation for User Story 2

- [x] T040 [P] [US2] Bearing residuals and analytic Jacobian for state (x0, y0, vx, vy), skipping invalid rows, in `packages/classical/src/residuals.ts`
- [x] T041 [P] [US2] Coarse grid initialiser (12 log ranges 1–40 km × 8 courses × 3 speeds along first valid bearing) in `packages/classical/src/grid-init.ts`
- [x] T042 [US2] Levenberg–Marquardt Gauss–Newton loop with convergence criteria, iteration cap, `converged` flag (covariance deferred: no schema slot and no consumer in iteration 0) in `packages/classical/src/lsq.ts`
- [x] T043 [US2] Per-timestep mode with warm start in `packages/classical/src/lsq.ts`
- [x] T044 [US2] Prediction NDJSON writer (header with estimator, mode, dataset SHA-256) in `packages/classical/src/predictions.ts`
- [x] T045 [US2] `tma-solve` CLI in `packages/classical/src/cli-solve.ts`

**Checkpoint**: generator verified — G0 check (1) demonstrable from the command line.

---

## Phase 5: User Story 3 — Score any estimator and judge G0 (Priority: P2)

**Goal**: naive baseline, metrics, slices, curves, experiment folder, G0 verdict.

**Independent Test**: naive twice → identical metrics; classical on noise-free → G0 pass; corrupt a prediction → metrics move.

### Tests for User Story 3 ⚠️

- [ ] T046 [P] [US3] Metric unit tests (relative range error, wrapped course error 359°/1° = 2°, speed in kt, median/P90 on known arrays, gross-error rate counts non-converged) in `packages/eval/test/metrics.test.ts`
- [ ] T047 [P] [US3] Slicing tests (range/zig/σ bands from research R8, empty slice handling) in `packages/eval/test/slices.test.ts`
- [ ] T048 [P] [US3] 5-minute point exclusion test (short window → excluded and counted) in `packages/eval/test/curves.test.ts`
- [ ] T049 [P] [US3] Report refusal test: `tma-eval` without naive + classical inputs exits non-zero (FR-019) in `packages/eval/test/cli-eval.test.ts`
- [ ] T050 [P] [US3] G0 gate tests (pass case; fail when one scenario exceeds tolerance; fail when naive runs differ) in `packages/eval/test/gate.test.ts`
- [ ] T081 [P] [US3] Golden test for `packages/eval`: fixed truth + fixed naive/classical predictions → byte-compare `metrics.csv`, `metrics.json`, `curves.csv`, `verdict.json` (timestamps and git commit masked) with `packages/eval/test/golden/` in `packages/eval/test/golden.test.ts`
- [ ] T051 [P] [US3] Naive baseline tests (training means of log range, course unit vector, speed; deterministic) in `packages/classical/test/naive.test.ts`

### Implementation for User Story 3

- [ ] T052 [P] [US3] Naive baseline fit/predict (final and `--per-timestep` modes) in `packages/classical/src/naive.ts` and `tma-naive` CLI in `packages/classical/src/cli-naive.ts`
- [ ] T053 [P] [US3] Metrics (final-point and per-row) in `packages/eval/src/metrics.ts`
- [ ] T054 [P] [US3] Slices in `packages/eval/src/slices.ts`
- [ ] T055 [US3] Time-since-zig curves and `zig+300s` point with exclusions in `packages/eval/src/curves.ts`
- [ ] T056 [US3] Manifest writer (git commit, versions, datasets, command lines) and `seeds.txt` in `packages/eval/src/manifest.ts`
- [ ] T057 [US3] `tma-eval` CLI writing `metrics.csv`, `metrics.json`, `curves.csv`; dataset digest check; FR-019 refusal in `packages/eval/src/cli-eval.ts`
- [ ] T058 [US3] G0 gate logic and `tma-gate` CLI writing `verdict.json` (exit 3 on fail) in `packages/eval/src/gate.ts` and `packages/eval/src/cli-gate.ts`
- [ ] T059 [US3] `tma-g0` orchestration script (two naive evals + gate) in `scripts/g0.ts`
- [ ] T060 [US3] CI end-to-end G0 on 1,000 noise-free scenarios in `.github/workflows/ci.yml`
- [ ] T061 [US3] Run quickstart §3 at 10^5 scenarios and commit `experiments/20261011-g0/` (manifest, metrics, verdict, seeds)

**Checkpoint**: **G0 verdict exists**. Iteration 1 may start once team review accepts it.

---

## Phase 6: User Story 4 — Model-ready input and output layout (Priority: P2)

**Goal**: SRD §4 tensors with masks and inputs-only normalisation.

**Independent Test**: hand-check channels on a known scenario; shuffled-label leakage test.

### Tests for User Story 4 ⚠️

- [x] T062 [P] [US4] Layout tests: 240 rows, window mask, valid flag at dropouts, sin/cos channels, km scaling, post-zig loss mask, on a hand-built scenario in `packages/features/test/layout.test.ts`
- [x] T063 [P] [US4] Leakage test: normalisation constants identical with target tracks shuffled across scenarios in `packages/features/test/leakage.test.ts`
- [x] T064 [P] [US4] Golden test: seed 1, 20 scenarios → byte-compare features binary in `packages/features/test/golden.test.ts`

### Implementation for User Story 4

- [x] T065 [P] [US4] Normalisation constants from train-split inputs only in `packages/features/src/normalise.ts`
- [x] T066 [US4] Window → inputs/targets/masks as pure functions over `Float32Array` in `packages/features/src/layout.ts`
- [x] T067 [US4] Features binary writer (shape header + Float32 tensors) and `tma-features` CLI (`norm`, `build`) in `packages/features/src/cli.ts`

**Checkpoint**: iteration 1 training can consume `*.features.bin` directly.

---

## Phase 7: User Story 5 — Reviewable, portable project (Priority: P3)

**Goal**: site, data dictionary, deploy, PR template.

**Independent Test**: stale schema PR fails CI; site builds with data dictionary listing every class.

- [ ] T068 [US5] Scaffold Docusaurus 3 in `site/` (docs + blog), base URL for GitHub Pages
- [ ] T069 [P] [US5] `site:dictionary` script copying `gen-markdown` output to `site/docs/data-dictionary/`; add to `schema:gen`
- [ ] T070 [P] [US5] Welcome page reading latest `experiments/*/verdict.json` at build time in `site/src/pages/index.tsx`
- [ ] T071 [P] [US5] Glossary in `site/docs/glossary.md` (ownship, zig, observability, bearing, time-late, instantaneous, gate, gross error, held-out geometry)
- [ ] T072 [P] [US5] Algorithm notes with formulae: `site/docs/algorithms/generator.md`, `feature-layout.md`, `naive-baseline.md`, `least-squares-solver.md`
- [ ] T073 [P] [US5] Blog post for iteration 0 with G0 verdict in `site/blog/<YYYY-MM-DD>-iteration-0.md` (date set when G0 is judged)
- [ ] T074 [US5] Add `site:build` to `.github/workflows/ci.yml`; create `.github/workflows/deploy-site.yml` (main → `gh-pages`, `keep_files: true`)
- [ ] T075 [P] [US5] `.github/pull_request_template.md` with site-page checklist and constitution check

**Checkpoint**: quickstart §6 passes; site live.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T076 [P] Update `AGENTS.md` "Workflow" with the real commands (lint, typecheck, test, golden, schema:check, site:build)
- [ ] T077 [P] README.md: one-paragraph purpose, link to site, SRD and quickstart
- [ ] T078 Run full `specs/001-iteration-0-pipeline/quickstart.md` on a clean clone; record timings against SC-002 and SC-006 in the iteration-0 blog post
- [ ] T079 Adversarial review of G0: confirm T020 known-answer tests would catch a shared sign/frame error that the solver alone would not

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (1) → Foundational (2) → user stories.
- **US1** depends on Foundational only.
- **US2** depends on US1 (needs generated scenarios and readers).
- **US3** depends on US1 (truth files) and US2 (classical predictions for G0 and FR-019).
- **US4** depends on US1 only — can run alongside US2/US3.
- **US5** T068–T072, T075 can start after Setup; T073 needs T061; T069 needs T011.
- Polish after all stories.

### Within each story

Tests first (fail) → pure functions → IO → CLI → golden files.

### Parallel opportunities

- Setup: T003–T006 together.
- Foundational: T014, T015, T017–T019 together once T011 is drafted.
- US1: T020–T024 and T080 together; T025, T030, T031 together.
- US2: T036–T039 together; T040, T041 together.
- US3: T046–T051 and T081 together; T052–T054 together.
- US4 in parallel with US2/US3 by a second developer.

### Parallel example: User Story 1

```
T020 known-answer tests   | T021 invariants | T022 golden | T023 round-trip | T024 throughput
then: T025 ranges | T030 ndjson | T031 f32pack
then: T026 → T027 → T028 → T029 → T032 → T033 → T034 → T035
```

## Implementation Strategy

### MVP

Setup → Foundational → US1 → US2. Stop and validate: the generator is verified by an independent
solver and by hand-computed known answers. This is the minimum needed to trust any later result.

### Incremental delivery

1. US1 + US2 → generator verified (PR 1).
2. US3 → G0 verdict committed (PR 2).
3. US4 → layout ready for iteration 1 (PR 3, can overlap with PR 2).
4. US5 + Polish → site live (PR 4; site pages for each earlier PR ride with that PR where possible,
   per constitution workflow).

### Notes

- Each PR must add the matching site page (constitution workflow); US5 provides the scaffolding, so
  until T068 lands, earlier PRs add Markdown under `site/docs/` that T068 picks up.
- Commit after each task or logical group; never commit datasets under `data/`.
