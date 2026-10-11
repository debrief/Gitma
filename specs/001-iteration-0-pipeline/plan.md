# Implementation Plan: Iteration 0 — Verified Experiment Pipeline (Gate G0)

**Branch**: `001-iteration-0-pipeline` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-iteration-0-pipeline/spec.md`

## Summary

Build the file-based pipeline of SRD §6 up to, but excluding, model training: a deterministic scenario
generator, lossless NDJSON ↔ Float32 storage with splits, the SRD §4 feature layout, a naive baseline, an
LM-damped Gauss–Newton bearings-only solver, and an evaluation harness that writes
`experiments/<id>/` and judges G0. All types come from one LinkML schema via JSON Schema → zod. CI,
golden tests and a Docusaurus site land alongside so every later iteration is configuration only.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`), ESM, Node 22 LTS (pinned).
Python 3.12 via `uv` for LinkML (dev only).

**Primary Dependencies**: zod, json-schema-to-zod (codegen), LinkML 1.12 (`gen-json-schema`,
`gen-markdown`), vitest, ESLint + typescript-eslint, Prettier, Docusaurus 3. No tfjs in this feature.

**Storage**: files — NDJSON and `.f32pack` datasets (not committed), `experiments/` (committed).

**Testing**: vitest unit tests, golden-file tests per package, property tests for geometry invariants,
an end-to-end G0 test on 1,000 scenarios in CI.

**Target Platform**: developer laptops (Linux/macOS) and GitHub Actions ubuntu-latest.

**Project Type**: pnpm monorepo of libraries + CLIs, plus a static site.

**Performance Goals**: ≥ 1,000 scenarios/s generation single-threaded; G0 on 10^5 scenarios < 15 min.

**Constraints**: byte-identical outputs under pinned Node; public repo, mock data only.

**Scale/Scope**: 10^5 scenarios per run (iteration 1 sizing); 7 packages; ~6 CLIs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
| --- | --- | --- |
| I. Single source of types | All records in `schema/tma.yaml`; `packages/types` generated; CI `schema:check` | ✅ |
| II. Determinism | xoshiro128**/SplitMix64, per-scenario derived seeds, float32-rounded storage, versions in every file, golden tests per package under pinned Node | ✅ |
| III. Portability | `sim`/`features` pure functions over typed arrays; one CLI per stage; no models yet; port acceptance at float32 | ✅ |
| IV. Honest measurement | Medians/P90, slices, gross-error rate; `tma-eval` refuses reports without naive + classical; inputs-only normalisation with leakage test | ✅ |
| V. Fail fast | G0 implemented as an executable gate; no training code in this feature | ✅ |
| Technical constraints | Node 22, TS strict, no `any`, SI units, frame per SRD §2 | ✅ |
| Workflow | CI on PRs, site pages for each new concept/algorithm, spec cites SRD | ✅ |

**Post-design re-check (after Phase 1)**: no violations against constitution v1.1.0 (PR #4), which
scopes byte-identity to the pinned Node version, requires float32 rounding of stored values, and defines
port acceptance at float32 precision (R3).

## Project Structure

### Documentation (this feature)

```text
specs/001-iteration-0-pipeline/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── file-formats.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
schema/
└── tma.yaml                    # LinkML source of truth
packages/
├── types/                      # GENERATED: JSON Schema, zod schemas, z.infer types
│   ├── generated/
│   └── scripts/generate.ts     # LinkML → JSON Schema → zod (invokes uv)
├── sim/                        # pure: prng, motion, observer, scenario draw
│   ├── src/{prng,geometry,motion,observer,scenario}.ts
│   └── test/{unit,golden}/
├── data/                       # CLIs tma-generate, tma-convert; ndjson + f32pack io; splits
│   ├── src/{ndjson,f32pack,splits,cli-generate,cli-convert}.ts
│   └── test/
├── features/                   # pure: window → tensors; normalisation; CLI tma-features
│   ├── src/{layout,normalise,cli}.ts
│   └── test/
├── classical/                  # naive baseline; LM Gauss–Newton solver; CLIs tma-naive, tma-solve
│   ├── src/{naive,lsq,grid-init,cli-naive,cli-solve}.ts
│   └── test/
└── eval/                       # metrics, slicing, curves, manifest, gate; CLIs tma-eval, tma-gate
    ├── src/{metrics,slices,curves,manifest,gate,cli-eval,cli-gate}.ts
    └── test/
experiments/
└── 20261011-g0/                # first committed verdict
site/                           # Docusaurus: welcome, glossary, data-dictionary (generated), algorithms
.github/
├── workflows/ci.yml            # lint, typecheck, test, golden, schema:check, site build, e2e G0 (1k)
├── workflows/deploy-site.yml   # main → gh-pages (keep_files)
└── pull_request_template.md    # site-page checklist
.nvmrc  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  pyproject.toml
```

**Structure Decision**: the SRD §6 layout minus `models/` and `demos/`, which arrive in iteration 1.
`pyproject.toml` + `uv.lock` pin LinkML for reproducible codegen.

## Phasing (input to /speckit-tasks)

1. **Setup**: workspace, tsconfig, lint, CI skeleton, `.nvmrc`, `pyproject.toml`.
2. **Foundation**: schema + codegen spike (R1) → `packages/types`; PRNG with known-answer tests.
3. **US1** generator + storage + splits (P1).
4. **US2** solver; noise-free recovery test (P1) — **checkpoint: generator verified**.
5. **US3** naive + eval + gate → first `experiments/20261011-g0/` (P2).
6. **US4** feature layout + leakage test (P2).
7. **US5** site pages, data dictionary, deploy workflow, PR template (P3).

## Complexity Tracking

No constitution violations to justify.

## Critical notes for review

- **R3 was the main design risk**: the v1.0.0 port promise was stronger than JS/Python maths
  libraries allow. Resolved by constitution v1.1.0 (PR #4); this plan assumes that PR merges first.
- **G0 is necessary, not sufficient**: a solver that recovers noise-free truth proves the geometry is
  self-consistent, not that it is *right* (a consistent sign error in both generator and solver would
  pass). Mitigation in tasks: hand-computed known-answer tests for the generator (e.g. target dead ahead
  closing, bearing constant) independent of the solver.
- **5-min gate point**: with 10-min windows and zig at 60%, only 4 min remain post-zig, so those
  scenarios are excluded from the gate figure. Under uniform window and zig draws about 2% are
  excluded; reported, not hidden.
- **Classical per-timestep cost** is the likeliest performance problem; warm starts should handle it,
  but if not, evaluate per-timestep on a 10^4 subset and say so in the report.
