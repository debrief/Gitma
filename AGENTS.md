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

## Repository layout

```
schema/tma.yaml        LinkML source of truth for all data types (version in `version:`)
packages/
  types/               generated zod schemas + types in src/generated/ (pnpm schema:gen)
  sim/                 PRNG, geometry, scenario generator (pure functions)
  data/                NDJSON + .f32pack I/O, splits; CLIs tma-generate, tma-convert
  features/            model tensors, inputs-only normalisation; CLI tma-features
  classical/           naive baseline, least-squares solver; CLIs tma-naive, tma-solve
  eval/                metrics, slices, curves, gates; CLIs tma-eval, tma-gate, tma-g0
experiments/<id>/      committed run outputs: manifest, metrics, curves, verdict, seeds
site/                  Docusaurus site (docs, blog); data dictionary generated at build
specs/                 Spec Kit features (spec, plan, research, contracts, tasks)
docs/SRD.md            requirements
```

## Commands

```
pnpm install && uv sync          # Node deps + LinkML (dev-only Python)
pnpm build                       # tsc -b (CLIs run from dist/)
pnpm lint                        # ESLint + Prettier check
pnpm typecheck                   # project build + tests/scripts
pnpm test                        # vitest: unit, golden, e2e (~30 s)
UPDATE_GOLDEN=1 pnpm test        # regenerate golden files; review the diff, say why in the PR
pnpm schema:gen                  # after editing schema/tma.yaml; bump its version
pnpm schema:check                # fails if generated types are stale
pnpm site:build                  # data dictionary + gate status + site; fails on broken links
pnpm tma-generate --seed 42 --count 100000 --noise-free --out data/g0
pnpm tma-g0 --data data/g0 --experiment experiments/<id>
```

Full walkthrough: `specs/001-iteration-0-pipeline/quickstart.md`.

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
- Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check && pnpm site:build`.
- Use the PR template (`.github/pull_request_template.md`): constitution and site-page checklists.

## Gotchas (learned in iteration 0)

- Stored floats go through `f32()` from `@tma/sim` (float32, and −0 → +0, which JSON cannot hold).
- Records are written as canonical JSON (sorted keys) via `canonicalJson` from `@tma/data`; zod
  re-orders keys on parse, so insertion order is not stable.
- Prettier honours `.gitignore`; generated or committed machine output (`experiments/`, golden
  files) is in `.prettierignore` so it stays byte-identical to tool output.
- `site/package.json` must not set `"type": "module"`; Docusaurus's SSR build breaks.
- G0 passing does not prove the frame is right (generator-only frame errors pass it); the
  known-answer and t = 0 invariant tests in `packages/sim` are what catch those.
- Per-timestep classical estimates restart from the grid and flag implausible solutions; never
  remove that without re-running quickstart §4 (runaway ranges of 10¹² m otherwise).

## Gates (SRD §5)

G0 pipeline → G1 signal exists → G2 useful → G3 classical parity (stretch). Iteration 0 builds the
pipeline and must pass G0 before any training.
