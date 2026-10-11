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

1. `/speckit-constitution` — project principles, ratified in `.specify/memory/constitution.md` (v1.2.0). Plans MUST pass its checks.
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
  eval/                metrics, slices, curves, gates, bootstrap; CLIs tma-eval, tma-gate (g0, g1), tma-g0
  models/              tfjs-node models, training, predictions; CLIs tma-train, tma-model-predict, tma-g1
configs/               generator ranges (iter1-*.json) and training configs (iter1/<model>.json)
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
pnpm tma-train --config configs/iter1/<model>.json --train <dir>/train.features.bin \
  --val <dir>/validation.features.bin --out models/i1/<model>   # refuses without a G0 pass
pnpm tma-model-predict --model <dir> --truth <test.f32pack> --features <test.features.bin> --out <pred.ndjson>
pnpm tma-g1 --data data/i1 --models models/i1 --experiment experiments/<id>   # exit 3: gate not passed
pnpm tma-gate g1 --experiment <dir> --instantaneous <id> --time-late <id> \
  --causal-control <id> --mlp-control <id> --shuffled <id>                   # gate only, on existing metrics
```

Full walkthroughs: `specs/001-iteration-0-pipeline/quickstart.md`, `specs/002-iteration-1-signal/quickstart.md`.

## Training and re-scoring on GitHub Actions

Full training (≈ 5.5 h per model on 4 CPU cores) runs on GitHub-hosted runners, not in agent
sessions (containers are reclaimed when idle).

- **Train:** push a `train/**` branch carrying `.github/workflows/train.yml` and
  `.github/train-plan.json` (`models` to train; optional `reuse_run` whose model artifacts fill in
  the rest). One job per model, then a G1 job; results are pushed to `results/g1-<run id>`. Nothing
  merges automatically.
- **Re-score:** push an `eval/**` branch containing `experiments/<id>-g1/models/`;
  `.github/workflows/evaluate-g1.yml` re-runs `tma-g1` with current code and pushes
  `results/g1-eval-<run id>` (folder `<id>-r2`, with `bootstrap.json`).
- Weights are byte-reproducible only on the same CPU family (runners vary; `cpu_model` is in each
  manifest). The committed weights are the artefact of record; reproduce a verdict by re-scoring
  them, not by re-training.
- G1 checks use a paired bootstrap 95% interval of model/naive median range error at zig + 300 s:
  pass if wholly below 0.5, fail if wholly at or above, otherwise `inconclusive` (also exit 3).

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

## Gotchas (learned in iterations 0–1)

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
- tfjs-node 4.22 `conv1d({padding: 'causal'})` silently acts as `'valid'`, and dilated convolutions
  have no gradient: causal padding is built from Keras layers (spec 002 research R3).
- Training determinism needs seeded initializers and `trainOnBatch` in PRNG order; never
  `fit({shuffle: true})`.

## Gates (SRD §5)

G0 pipeline → G1 signal exists → G2 useful → G3 classical parity (stretch). Iteration 0 builds the
pipeline and must pass G0 before any training. G0 passed (panel round 3,
`experiments/20261011-g0-r3/`); iteration 1 is training toward G1 (spec 002).

Gate decisions come from an **agent review panel**, never from waiting on humans (constitution
1.2.0). For each gate experiment:

1. Launch ≥ 5 independent reviewers in parallel, one per speciality: TMA geometry, estimation and
   numerics, evaluation statistics, reproducibility (re-runs the experiment from the manifest),
   red team (looks for ways the gate passes while the pipeline is wrong, incl. leakage).
   Reviewers are read-only; they return `VERDICT: approve | approve-with-findings | reject` and
   severity-tagged findings (blocker / major / minor) with evidence.
2. Fix or answer (with evidence) every blocker and major finding; fix minors that are cheap.
3. Re-invite the reviewers with the response and ask for further review; repeat until none
   rejects and no blocker or major finding is open.
4. Commit `experiments/<id>/review.md` (each round's reviews and responses) and set the verdict's
   `decided_by` to the panel round that approved it.

G1 briefs (evidence, questions, output format, word limit) are in
`specs/002-iteration-1-signal/g1-panel-briefs.md`; what G1 cannot detect is in `g1-limits.md`.
