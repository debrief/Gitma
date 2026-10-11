# Research: Iteration 0 — Verified Experiment Pipeline

Phase 0 output for [plan.md](plan.md). Each item: decision, rationale, alternatives.

## R1. LinkML → TypeScript types and validators (SRD §9 open question)

- **Decision**: LinkML → `gen-json-schema` → `json-schema-to-zod` → zod schemas; TS types are
  `z.infer<>` of those schemas. LinkML's `gen-typescript` is **not** used.
- **Rationale**: spike with linkml 1.12.0 (2026-10-11) shows `gen-typescript` emits plain interfaces
  only (no validators) and models optional multivalued slots as `samples?: number[]`, while
  `gen-json-schema` emits `type: ["array","null"]`. Two generators would give two slightly different
  type systems. One path (JSON Schema) yields validators and types that cannot drift, and JSON Schema
  is also what a Python/Java port can consume.
- **Alternatives**: `gen-typescript` + hand-written zod (forbidden by constitution I);
  `gen-typescript` + `ts-to-zod` (two generators, drift risk); `gen-pydantic` → JSON Schema (extra hop).
- **Follow-up**: first task is a spike confirming `json-schema-to-zod` handles `$defs`, enums and
  nullable arrays; if not, fall back to a ~100-line in-repo JSON-Schema→zod generator (still generated,
  still no hand-written types).

## R2. Seeded PRNG

- **Decision**: xoshiro128** for the stream, seeded from the 64-bit seed via SplitMix64 (BigInt used
  only at seeding). Gaussian draws via Box–Muller with the second value discarded (simpler, stateless).
  Each scenario's seed is derived as `splitmix64(datasetSeed, scenarioIndex)` so scenarios are
  independent and generation can be sharded without changing output.
- **Rationale**: 32-bit integer ops are fast in JS (`Math.imul`, `>>> 0`); BigInt per draw would miss
  the 1,000 scenarios/s target. Both algorithms are short, public, and trivially portable to Python/Java.
- **Alternatives**: `seedrandom` (ARC4 default, 32-bit-ish seeding, extra dependency); PCG64 (needs
  64-bit multiply → BigInt in JS, slow).

## R3. Cross-platform determinism — **risk found**

- **Finding**: `Math.sin/cos/atan2/log/exp` are not required by ECMAScript to be correctly rounded.
  V8 uses its own fdlibm port, so results are identical across OSes for the **same Node version**, but
  not guaranteed across Node majors, and **not** bit-identical to Python's `math` or Java's
  `StrictMath`/`Math` in all cases.
- **Decision**:
  1. Pin Node 22.x in `.nvmrc`/CI; golden files are byte-identical within that pin (constitution II
     holds for TS).
  2. All stored floats are rounded to float32 (`Math.fround`) before writing (see R4). This absorbs
     last-ulp float64 differences in the vast majority of values.
  3. For ports, the golden-file acceptance rule becomes: integers, flags and seeds byte-identical;
     floats equal after float32 rounding, with any residual mismatch ≤ 1 float32 ulp reported.
- **Action**: this narrows constitution principle III's "a port passes when it reproduces the golden
  files". Resolved by constitution v1.1.0 (PR #4).
- **Alternatives**: software-implemented, correctly rounded transcendental functions (e.g. a CORE-MATH
  port) — exact but slow and a lot of code for a proof of concept.

## R4. Storage formats and lossless round-trip

- **Decision**:
  - Inspection format: NDJSON, one scenario per line, keys in schema order, numbers as JS shortest
    round-trip of the float32-rounded value. First line is a header record (versions, seed range, split,
    parameter ranges).
  - Training format: `.f32pack` = fixed little-endian header (magic, versions, counts, JSON-encoded
    metadata block length) + per-scenario Float32 arrays in a fixed channel order defined in the schema.
  - All floating values are float32-rounded at generation time so both formats hold identical values.
- **Rationale**: SRD asks for a Float32 pack and lossless round-trip; that is only possible if the
  canonical values are already float32. Float32 (~7 significant digits) is ample: 1 mm at 20 km, 1e-7 rad.
- **Alternatives**: float64 binary (doubles storage; SRD specifies Float32); Arrow/Parquet (heavier
  dependency, port-friendly but overkill for iteration 0).
- **Note**: the classical solver and truth comparisons in G0 run on float32-rounded data, so "noise-free
  recovery" tolerance must sit above float32 precision — SC-001's 0.1% / 0.1° / 0.01 kt is far above it.

## R5. Classical solver

- **Decision**: Levenberg–Marquardt-damped Gauss–Newton on state `(x0, y0, vx, vy)` at window start.
  Residual = wrapped bearing difference `atan2(sin Δ, cos Δ)`, dropouts skipped. Initialisation: grid of
  ranges along the first valid bearing (log-spaced, 1–40 km, 12 values) × target courses (8) × speeds
  (3); best grid cost seeds LM. Converged when relative cost change < 1e-12 or step < 1e-6 m, max 50
  iterations. Reports `converged`, `iterations`, `final_cost`, and the 4×4 covariance.
- **Instantaneous mode**: for each post-zig timestep, re-solve using bearings up to t, warm-started from
  the previous timestep's solution (grid only at the first post-zig step).
- **Rationale**: plain Gauss–Newton diverges on poor geometry; LM damping is a one-line change and is
  still "batch least squares" as the SRD requires. Warm starts keep the per-timestep mode affordable
  (~10^5 scenarios × ~120 steps × few iterations of a 4×4 solve).
- **Alternatives**: modified-polar coordinates (better conditioned, more code; revisit if gross-error
  rate is poor); EKF (deferred by SRD until G3).

## R6. Monorepo and tooling

- **Decision**: pnpm workspace; TypeScript project references (`tsc -b`); ESLint (flat config,
  typescript-eslint strict) + Prettier; vitest; CLIs use `node:util` `parseArgs` (no CLI dependency).
  `@tensorflow/tfjs-node` is **not** installed in iteration 0 (no models yet; native build cost).
- **Rationale**: matches SRD §6 stack; fewest dependencies; `tsc -b` gives incremental builds across
  packages.

## R7. Site and deployment

- **Decision**: Docusaurus 3 in `site/`. CI copies LinkML `gen-markdown` output into
  `site/docs/data-dictionary/`. On merge to `main`, deploy to the `gh-pages` branch with
  `peaceiris/actions-gh-pages` using `keep_files: true` so future `/pr/N/` previews survive.
  Welcome page reads gate status from the latest `experiments/*/verdict.json` at build time.
- **Rationale**: SRD §9 tooling decisions; `gh-pages` branch (not Pages artifacts) is needed for
  per-PR preview folders later.

## R8. Slicing bands and experiment ids

- **Decision**: range bands 2–5, 5–10, 10–20, 20–30 km (mean range over window); zig bands 30–50,
  50–70, 70–90°; σ as stored. Experiment id `YYYYMMDD-<slug>` (e.g. `20261011-g0`).
- **Rationale**: roughly equal scenario counts per range band under log-uniform sampling; the 20–30 km
  band only populates in the held-out geometry set.
