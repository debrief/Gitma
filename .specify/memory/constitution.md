# TMA via ML Constitution

## Core Principles

### I. Single Source of Truth for Types (NON-NEGOTIABLE)

- Every data type (scenario, track, observation, feature tensor layout, model manifest, metrics
  record) MUST be defined once in LinkML under `schema/`.
- TypeScript types, JSON Schema, `zod` validators and the data dictionary MUST be generated from
  that schema; hand-written equivalents are forbidden.
- Generated output in `packages/types/` is committed; CI MUST fail if it is stale.
- Every file read at runtime MUST be validated with the generated validators.
- Tensor shapes MUST be recorded in the LinkML description of each feature type.

Rationale: the later Python/Java port starts from identical types, and the data dictionary can
never drift from the code.

### II. Determinism and Reproducibility (NON-NEGOTIABLE)

- All randomness MUST come from a seeded PRNG keyed by a 64-bit seed; `Math.random` is forbidden.
- The same seed MUST reproduce the same scenario byte-for-byte on any OS under the pinned Node
  runtime version (`.nvmrc`); changing the pin MAY require regenerating golden files.
- Stored floating-point values MUST be rounded to float32 at generation time, so last-bit
  differences in maths libraries do not reach stored data.
- Every dataset file MUST carry the schema and generator version; mismatched files are rejected.
- Every training run MUST be reproducible from its manifest (hyperparameters, dataset seed,
  normalisation constants, generator version) plus its dataset.
- Every package MUST have a golden-file test: fixed seed in, byte-identical output out.

Rationale: a go/no-go verdict is worthless if the experiment behind it cannot be re-run.

### III. Portability by Construction

- `sim` and `features` MUST be plain functions over numeric arrays: no classes with hidden state,
  no TS-only idioms.
- Models MUST use only layers with direct Keras equivalents (LSTM, Bidirectional, Conv1D, Dense,
  Masking); hyperparameters live in the manifest, not in code.
- Each pipeline stage MUST be a separate CLI reading and writing files, so any stage can be
  replaced (e.g. generator by Stone Soup, training by PyTorch) without touching the others.
- A port is accepted when it reproduces the golden files: integers, flags, seeds and strings
  byte-identical; floats equal after float32 rounding, with any residual mismatch no greater than
  1 float32 ulp and reported.

Rationale: TypeScript is the proof-of-concept vehicle, not the destination. Transcendental maths
functions are not bit-identical across languages, so ports are judged at float32 precision.

### IV. Honest Measurement

- Model results MUST NOT be reported without the naive baseline and classical solver numbers on
  the same test set beside it.
- Metrics MUST be reported as median and 90th percentile, overall and sliced by range band, zig
  angle and noise σ; gross-error rate MUST be reported alongside.
- Normalisation statistics MUST be computed from inputs only; a shuffled-label leakage test MUST
  score at naive-baseline level.
- The time-late variant MUST score at least as well as the instantaneous variant at every point;
  if not, the pipeline is treated as suspect before any ML conclusion is drawn.
- Recurrent models MUST beat their non-recurrent control to claim sequential learning.

Rationale: TMA failure modes are heavy-tailed, and the main risk is a model that learns the
generator's priors rather than geometry.

### V. Fail Fast Through Gates

- Work proceeds through gates G0 (pipeline) → G1 (signal) → G2 (useful) → G3 (parity, stretch) as
  defined in `docs/SRD.md` §5.
- No training MAY begin until G0 passes: the classical solver recovers noise-free truth and the
  naive baseline is reproduced.
- A failed G1 ends the project with a short write-up; a failed G2 allows one further iteration.
- Hyperparameter search is capped at a handful of runs per iteration; the question is whether the
  signal exists, not how good the best model can be.

Rationale: the project exists to answer one question cheaply, not to build a product.

## Technical Constraints

- Node 22 LTS, TypeScript 5 with `strict` and `noUncheckedIndexedAccess`, ESM, `pnpm` workspace.
- No `any` outside generated code.
- `@tensorflow/tfjs-node` for training and inference (GPU optional, never assumed); `vitest` for
  tests.
- LinkML toolchain is a Python dev dependency only, managed with `uv`.
- Frame: flat-earth Cartesian, x east, y north, metres. Bearings true, clockwise from north, in
  radians internally. Speeds in m/s; knots only for reporting.
- Scope is single target, constant velocity, Gaussian bearing noise and dropouts only; anything
  beyond `docs/SRD.md` §1 scope requires an SRD amendment first.
- The repository is public: nothing above OFFICIAL, and only mock data with no real-world
  provenance.

## Development Workflow

- Every change lands via a PR against `main`; no direct pushes.
- CI on each PR MUST run lint, typecheck, unit and golden-file tests, schema regeneration check
  and site build; all MUST pass before merge.
- A PR that adds a concept, data type, algorithm or result MUST add or update the matching page
  under `site/` (glossary, data dictionary regeneration, algorithm note or blog post). Reviewers
  may block on a missing page.
- Each iteration produces an `experiments/<id>/` folder (manifest, dataset seeds, metrics CSV,
  gate verdict) and a blog post with the gate decision.
- Feature work follows the Spec Kit flow (specify → plan → tasks → implement); each spec MUST
  cite the SRD section(s) it implements.

## Governance

- This constitution governs all development practice; `docs/SRD.md` governs requirements. Where
  they conflict, raise it and amend one of them — do not silently pick.
- Amendments are made by PR that updates this file, states the version bump and its rationale,
  and updates `AGENTS.md` if agent guidance changes.
- Versioning is semantic: MAJOR for removing or redefining a principle, MINOR for adding a
  principle or materially expanding guidance, PATCH for clarifications.
- Every PR review MUST check compliance with the principles above; any justified exception is
  recorded in the PR description.
- Gate verdicts are taken at a team review against SRD §5 metrics; Doc holds the casting vote
  where the numbers are borderline.
- Runtime guidance for agents lives in `AGENTS.md`.

**Version**: 1.1.0 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-11
