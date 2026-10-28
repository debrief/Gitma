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
  demos/               browser engagement and model viewer (spec 006); site page /viewer
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
pnpm site:build                  # tsc -b, then data dictionary + gate status + viewer catalogue + site
node scripts/viewer-smoke.mjs [url] [dir]   # Playwright smoke of a served /viewer (PLAYWRIGHT=<pkg dir>)
pnpm tma-generate --seed 42 --count 100000 --noise-free --out data/g0
pnpm tma-g0 --data data/g0 --experiment experiments/<id>
pnpm tma-train --config configs/iter1/<model>.json --train <dir>/train.features.bin \
  --val <dir>/validation.features.bin --out models/i1/<model>   # refuses without a G0 pass
pnpm tma-model-predict --model <dir> --truth <test.f32pack> --features <test.features.bin> --out <pred.ndjson> [--train <train.f32pack>]
pnpm tma-g1 --data data/i1 --models models/i1 --experiment experiments/<id>   # exit 3: gate not passed
pnpm tma-gate g1 --experiment <dir> --instantaneous <id> --time-late <id> \
  --causal-control <id> --mlp-control <id> --shuffled <id>                   # gate only, on existing metrics
node scripts/train-plan.mjs data configs/iter2/b/plan.json data/i2 train validation test heldout  # digests checked
pnpm tma-g2 --data data/i2 --models <carried models> --split validation --experiment <dir>   # diagnostic only
pnpm tma-scan --data data/i2 --models <any models> --experiment <dir>   # side experiment: validation only, scan.md
pnpm tma-g2 --data data/i2 --models <carried> --compare-models <other phase> \
  --decision <committed decision.json> --plan <plan.json> --split test \
  --experiment experiments/<id>   # the gate: checks plan digests, decision ancestry, same rows; exit 3: not passed
pnpm tma-track --in <split.f32pack> --out <pred.ndjson> --filter imm --sigma-cv <a> --sigma-ct <a> \
  --sigma-omega <w> --switch <p>          # or --filter ekf --sigma-a <a>; per-timestep tracker rows
pnpm tma-hybrid --truth <test.f32pack> --classical <classical.ndjson> --network <lstm.ndjson> --out <hybrid.ndjson>
pnpm tma-g3 --truth <test.f32pack> --hybrid <hybrid.ndjson> --classical <classical.ndjson> \
  --decision <committed decision.json> --experiment experiments/<id>   # G3 (spec 009); validation: diagnostic only
```

Full walkthroughs: `specs/001-iteration-0-pipeline/quickstart.md`, `specs/002-iteration-1-signal/quickstart.md`,
`specs/003-iteration-2-noise/quickstart.md`.

## Training and re-scoring on GitHub Actions

Full training (≈ 5.5 h per model on 4 CPU cores) runs on GitHub-hosted runners, not in agent
sessions (containers are reclaimed when idle).

- **Train:** push `train/i<iteration><phase>` (e.g. `train/i2a` → `configs/iter2/a/plan.json`;
  `train/i2s` is the capacity scan, evaluated by `tma-scan`), or
  dispatch `train.yml` with a `plan` input. A plan names the dataset (seed, ranges, pinned content
  digests, checked in every job by `scripts/train-plan.mjs`), the feature set, the model configs,
  an optional `continue_from`, and the `evaluate` step (`tma-g2`, validation or test). Each model
  trains in up to three chained ≤ 345-min jobs; checkpoints, with Adam state, go to
  `checkpoints/<branch>/<model>` after every epoch, so the next job (or a re-push) resumes; a
  job whose model is complete still runs `tma-train --check` (G0 guard + lineage) and then does
  nothing. Results go to `results/<plan id>-<run id>`. Nothing merges automatically. The
  iteration-1 `train/i1` + `.github/train-plan.json` path is retired (re-score instead).
- **Re-score:** push an `eval/**` branch containing `experiments/<id>-g1/models/`;
  `.github/workflows/evaluate-g1.yml` re-runs `tma-g1` with current code and pushes
  `results/g1-eval-<run id>` (folder `<id>-r2`, with `bootstrap.json`).
- **Benchmark:** push a `bench/**` branch; `.github/workflows/bench-train.yml` times LSTM/BiLSTM
  training steps (default vs 1 thread, padded vs length-bucketed) and uploads the table.
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
- **Provenance:** datasets record the generating commit (`generator_git_commit`); `tma-generate`
  refuses a dirty tree unless `--allow-dirty` (then recorded as `generator_git_dirty: true`). Models
  record their source dataset header; training, resume and scoring refuse features from other data.
  Gate data comes from a plan whose content digests are checked (`scripts/train-plan.mjs`).
- **Feature sets:** `raw` (10 channels) or `derived` (13: adds bearing rate, its validity flag and the
  bearing-line intercept); a model's config names its set and every CLI refuses a mismatch.
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
- Gate times count from `zig_index`, the first sample after the rate-limited turn ends (generator
  0.2.0), not the turn start; zig + 600 s is reached by only ~60% of scenarios (88% on generator 0.4.0, whose turn-fit redraw
  removes short windows), so state coverage.
- Data regenerated at a later commit has a different header digest though the scenarios are
  identical; prediction tolerates provenance-only header changes (both clean, constants equal) and
  `train-continue.mjs --train/--val` re-anchors digests. Always run the plan's digest check too.
- A test split is scored once per carried set; `tma-g2 --split test` needs the committed phase
  decision. Score phases in one run (`--compare-models`): other-phase predictions are tagged
  `<split>.other-phase.<id>.ndjson` so they never overwrite the carried set's.
- A seeded continuation that changes the loss re-scores the best epoch under the new loss and
  persists it as `best_val_loss` (schema 0.8.2); a chained job resumes against that value. Without
  it the old best, on the old scale, is never beaten and the old weights are kept silently.
- The viewer page imports `@tma/demos` from `dist/`, so `site:build` runs `tsc -b` first. The
  site's Babel compiles `[...iterable]` to `[].concat(iterable)`: in browser code spread arrays
  only, and use `Array.from` for NodeLists, Maps and Sets.
- Gate checks: pass needs the whole 95% CI and the point below the threshold; fail needs the CI's
  lower bound at or above it; anything else is inconclusive (FR-015).

## Gates (SRD §5)

G0 pipeline → G1 signal exists → G2 useful → G3 classical parity (stretch) → G4 better than the
EKF after a target turn (phase 3, Annex B). Iteration 0 builds the
pipeline and must pass G0 before any training. G0 passed (panel round 3,
`experiments/20261011-g0-r3/`). G1 passed (panel round 3, `experiments/20261012-g1-r2/`) under
pre-registered rule 1, with a caveat: time-late is not shown better than instantaneous. Iteration 2
(spec 003) changed the generator (rate-limited turn, provenance), so G0 was re-run and passed again
(panel rounds 1–3, `experiments/20261013-g0-i2-r2/`); `tma-train` accepts only a G0 whose
`decided_by` names a panel round and whose `review.md` is beside it. **G2 failed** (panel round 2,
`experiments/20261014-i2-g2/`): range and instantaneous course pass, speed fails for both models
(2.09 / 2.38 kt vs 1 kt; classical 0.62 kt, at the Cramér–Rao bound). Iteration 2b (spec 004)
continued every model from phase B with `loss_weight_speed` 4 and judged G2 on a fresh test split
(seed 202; plan `configs/iter2/c`, decision `experiments/20261014-i2c-decision/`). **G2 failed
again** (panel round 2, `experiments/20261015-i2c-g2/`): range and course pass for both models,
speed 1.77 kt for both (classical 0.60 kt). SRD §7 was amended on 2026-10-15 (before 2b's test
scoring) to allow one more iteration, 2c (spec 005, the last under G2): 2 × 128 stacked recurrent
layers with `loss_weight_speed` 4, from scratch, judged on fresh seed 203: plan `configs/iter2/d`,
decision `experiments/20261015-i2d-decision/`. **G2 failed a third time** (panel round 2,
`experiments/20261016-i2d-g2/`): range 13.5% / 12.1% and course 7.4° / 6.1° pass, speed 1.47 /
1.53 kt fails (classical 0.61 kt), no-go on speed and pass on range and course (write-up:
`site/blog/2026-10-17-iteration-2c.md`). Seeds 201–203 are reserved. **SRD Annex A** (accepted
2026-10-17) lifts the effort budget. The engagement and model viewer (spec 006, `packages/demos`,
site page `/viewer`) is built, and the owner's realism check is recorded (Annex A §A.7). Part B
levers are pre-registered one at a time, each with a decision record committed before training
and a fresh test seed (204 onward). **Iteration 3** (spec 007, decision 22) is lever B.2.1:
generator 0.3.0 adds a second zig 3–5 min into leg 2, and both turns cross the line of sight
(`zig_rule: across_los`). Its dataset is seed 204. G0 passed on 0.3.0 (panel round 3,
`experiments/20261017-g0-i3-r3/`). From iteration 3, `tma-g2 --split test` needs the committed
decision that names its plan and test seed (schema 0.9.1 `ChangeDecision.plan`, `test_seed`). **Iteration 3 stopped at validation** (FR-006,
`experiments/20261021-i3a-val/validation.md`): LSTM speed 1.10 kt [1.06, 1.16], so the rule's lower
bound under 1 kt fails; BiLSTM 1.02 kt [0.98, 1.05], reported only; classical 0.34 kt (models 3.0–3.3
× classical, against 2.4 × in 2c). Seed 204's test split is unscored and stays reserved. **Iteration 4**
(spec 008, decision 23) combines velocity outputs (`output_parameterisation: velocity`, schema
0.10.0) with the derived feature set, on iteration 3's problem, seed 205: plan `configs/iter4/a`,
decision `experiments/20261022-i4-decision/`, compared with the iteration-3 models on the same rows.
G2 on seed 205 was **inconclusive** (panel round 1, `experiments/20261024-i4-g2/`): instantaneous speed
0.981 kt [0.940, 1.031], everything else passes. SRD §7 allows one re-score: seed 206, 100,000 test
scenarios, the same frozen models (plan `configs/iter4/r`, decision
`experiments/20261024-i4-rescore-decision/`, schema 0.11.0 `rescore_of`, `model_digests`); a fail or
inconclusive there is final. **G2 passed** on the re-score (panel round 1,
`experiments/20261025-i4-g2-rescore/`): instantaneous speed 0.939 kt [0.926, 0.951], time-late
0.740 kt, range and course pass; classical 0.319 kt, so the models are still about 3 × classical on
speed (write-up: `site/blog/2026-10-25-iteration-4.md`). Seeds 205–206 are reserved. **Iteration 5**
(spec 009, decision 24) judges G3 for a **hybrid**, reported as such and not as a network alone.
It is classical's estimate, replaced by the frozen iteration-4 LSTM's where classical fails or the
two ranges differ by more than 50% (`hybridSwitch`). Research showed that a per-leg fit carries no
range rate on young legs (R1), and that a network-initialised solver reproduces classical (R2).
Fresh seed 207, 20,000 test scenarios; decision `experiments/20261027-i5-decision/`. **G3 passed
for the hybrid** (panel round 1, `experiments/20261028-i5-g3/`):
- **Ratios.** Every median and P90 is within 0.97–1.02 × classical.
- **Gross errors.** At zig + 300 s they fall from 1.19% to 0.57%; at zig + 600 s the difference
  is not significant (0.17% against 0.14%).
- **The LSTM alone** is still about 3 × classical on speed.

Write-up: `site/blog/2026-10-28-iteration-5.md`. Seeds 205–207 are reserved. `tma-g3` binds the
decision and the seed, but not the data or model digests (a follow-up). **Phase 3** (SRD Annex B,
decision 25, spec 010) tests the one place a learned estimator has an in-principle advantage:
generator 0.4.0 adds one target course change (80% of scenarios); a tracker, tuned on validation
and frozen, is the reference; **gate G4** asks the network alone to beat the better tuned tracker (IMM or EKF, fixed on validation) on
range and course at manoeuvre + 5 min without regressing on held-course scenarios. The follow-on
for each outcome is fixed in advance (Annex B §B.5). Status (PR 2): generator 0.4.0 (target turn, schema 0.12.0,
`configs/phase3-ranges.json`), slices `manoeuvre=…`, trackers `ekfPredict` / `immPredict` and
`tma-track`; G0 re-run on 0.4.0 (`experiments/20261028-g0-p3-r2/`, passed, panel rounds 1–2). The single Cartesian EKF drifts
after a turn even noise-free (Aidala), so the owner re-decided D3: the gated reference is the
tuned-turn **IMM** (CV + coordinated turn), the EKF reported. G0 checks batch least squares on each
scenario up to the target's turn (`beforeManoeuvre`); zigs are planned on the target's straight
track. Seed 900 is the viewer's phase-3 preview only. PR 3: research and tuning
(`experiments/20261028-p3-research/`), decision 26 (`experiments/20261028-p3-decision/`): the
frozen reference is `imm-cv0.003-ct0.1-w0.001-s0.001-r2` (13.6% median range error at manoeuvre +
300 s on validation; EKF 15.3%); the carried model is the iteration-4 LSTM configuration from
scratch on seed 208 (`configs/phase3/a`, push `train/p3a`; the job only commits the model); G4 on
fresh seed 209 (400,000, its 40,000-scenario test split) with `tma-g4 --decision --plan --model`.
Seeds 207–209 are reserved. `tma-g2 --rescore-of <gate>` binds the frozen weights by digest in place
of training ancestry; scoring streams from files (predictions written as made), and a preflight
refuses a run whose features are not built. Cloud containers live about 4–4.6 h, so an aborted
re-score is finished with `--reuse-predictions <committed reuse.json>`: each listed prediction file
is reused only if its SHA-256 matches. A model that is not `complete`
after three chained jobs stops the evaluation job: re-dispatch `train.yml` (it resumes).

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
