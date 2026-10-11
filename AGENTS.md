# AGENTS.md

Guidance for AI coding agents (Claude Code, Copilot, Codex, etc.) working in this repository.

## Project

**TMA via ML — TypeScript proof of concept.** Can a neural network trained on large volumes of simulated
bearings-only data produce usable target range, course and speed estimates? The outcome is a go/no-go gate,
not a product.

The authoritative requirements are in [`docs/SRD.md`](docs/SRD.md). Read it before planning any feature.
Where this file and the SRD disagree, the SRD wins; flag the conflict.

## Spec-driven workflow (GitHub Spec Kit)

Spec Kit is installed (`.specify/`, skills in `.claude/skills/speckit-*`). Feature work follows:

1. `/speckit-constitution` — project principles, ratified in `.specify/memory/constitution.md` (v1.1.0). Plans MUST pass its checks.
2. `/speckit-specify` — feature spec, traced to SRD sections
3. `/speckit-clarify` — optional, de-risk ambiguity
4. `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`

Specs live under `specs/<NNN-feature>/`. Each spec should cite the SRD section(s) it implements.

## Stack

- Node 22 LTS, TypeScript 5 (`strict`, `noUncheckedIndexedAccess`), ESM, `pnpm` workspace monorepo.
- `@tensorflow/tfjs-node` for training/inference; `vitest` for tests.
- LinkML (Python, dev-only, managed with `uv`) → JSON Schema → TS types + `zod` validators.
- Docusaurus site under `site/`, deployed to `gh-pages`; PR previews at `/pr/N/`.

## Repository layout (target)

```
schema/       LinkML source of truth for all data types
packages/
  types/      generated TS types + zod validators (CI-generated, committed)
  sim/        ownship + target motion, bearing observer
  data/       batch generation CLI, NDJSON <-> Float32 pack, splits
  features/   window -> tensor for each variant, normalisation stats
  models/     tfjs model definitions + training CLI + manifests
  classical/  naive baseline, least-squares bearings-only solver
  eval/       metrics, slicing, gate checks, report generation
  demos/      browser apps for PR previews (tfjs in-browser)
experiments/  one folder per run: manifest, metrics, plots
site/         GH Pages: welcome, blog, glossary, data dictionary, algorithms
docs/         SRD and other project documents
```

## Hard rules

- **Types:** every data type is defined once in LinkML under `schema/`. Never hand-write TS types for
  scenarios, tracks, observations, feature layouts, manifests or metrics records. Regenerate
  `packages/types/` after schema changes; CI fails on stale output.
- **No `any`** outside generated code.
- **Determinism:** seeded PRNG only — never `Math.random`. Same 64-bit seed ⇒ byte-identical output
  under the pinned Node version. Stored floats are float32-rounded at generation.
- **Golden tests:** every package has a fixed-seed, byte-identical golden-file test.
- **Portability:** `sim` and `features` are plain functions over numeric arrays — no classes with hidden
  state. Models use only layers with direct Keras equivalents (LSTM, Bidirectional, Conv1D, Dense, Masking);
  hyperparameters live in the manifest, not code.
- **Units/frame:** flat-earth Cartesian, x east, y north, metres; bearings true, clockwise from north,
  radians internally; speeds m/s (knots only for reporting).
- **No leakage:** normalisation stats computed from inputs only, never from truth.
- **Reporting:** no model result without naive and classical baselines on the same test set alongside it.
  Use medians and 90th percentiles, not means.
- **Classification:** public repo. Nothing above OFFICIAL; mock data only.
- Each pipeline stage is a separate CLI reading and writing files.

## Workflow

- All changes via PR against `main`; no direct pushes.
- A PR that adds a concept, data type, algorithm or result also adds/updates the matching `site/` page
  (glossary, data dictionary regeneration, algorithm note, or blog post).
- Before pushing, run lint, typecheck, unit + golden tests, schema regeneration check, and site build
  (commands to be added as the toolchain lands in iteration 0).

## Gates (SRD §5)

G0 pipeline → G1 signal exists → G2 useful → G3 classical parity (stretch). Iteration 0 builds the
pipeline and must pass G0 before any training.
