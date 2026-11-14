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

1. `/speckit-constitution` — project principles, ratified in `.specify/memory/constitution.md` (v1.3.0). Plans MUST pass its checks.
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
pnpm tma-fuse-track --truth <split.f32pack> --network <t2.ndjson> --out <fused.ndjson> --sigma-cv 0.01 \
  --sigma-ct 0.03 --sigma-omega 0.01 --switch 0.001 --p0-scale 4 --r-scale 8   # fused tracker (spec 014; k 4, every 6)
pnpm tma-g3 --truth <test.f32pack> --hybrid <hybrid.ndjson> --classical <classical.ndjson> \
  --decision <committed decision.json> [--plan <plan.json>] [--model <frozen model> --network <lstm.ndjson>] \
  --experiment experiments/<id>   # G3 (spec 009, bindings spec 015); validation: diagnostic only
node packages/eval/dist/cli-g5.js --truth <test.f32pack> --tracker <pred> --reference <pred> --also <pred>... \
  --decision <decision.json> --plan <plan.json> --model <model dir> --experiment <dir> \
  [--repeat-of experiments/<earlier>]   # G5 (spec 012; bindings spec 015); see each G5 run.sh
node packages/eval/dist/cli-detect.js --truth <split> --out <scores.ndjson> --detector cusum <IMM flags> \
  --kind nis|mean --c <drift> --clip <bound>   # or --detector disagree|crate --network <t2> (spec 017)
node packages/eval/dist/cli-g6.js --truth <split> --learned <scores>... --cusum <scores>... --experiment <dir> \
  [--also <pred>... --decision --plan --model]   # G6: validation calibrates; a test split is the gate
node packages/eval/dist/cli-g7.js --truth <split> --tracker <fused -sd> --reference <imm -sd> --experiment <dir> \
  [--also <t2> --decision --plan --model]   # G7 (spec 018): validation fits + two-fold; test is the gate
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
  state. Models use only layers with direct Keras equivalents (LSTM, Bidirectional, Conv1D, Dense, Masking),
  plus, from phase 4, a declared filter layer whose equations its algorithm note states (constitution
  1.3.0); hyperparameters live in the manifest, not code.
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
- The gate's ancestry checks (`precedes`, G0 guard) need git history: in a shallow clone they
  refuse or fail. Run `git fetch --unshallow origin` first.
- Generate gate data from a clean tree. While editing, use a clean `git worktree` at the base
  commit (its own `pnpm install && pnpm build`) and write into this checkout's `data/`.
- Gate checks: pass needs the whole 95% CI and the point below the threshold; fail needs the CI's
  lower bound at or above it; anything else is inconclusive (FR-015).

## Gates (SRD §5)

G0 pipeline → G1 signal exists → G2 useful → G3 classical parity (stretch) → G4 better than the
EKF after a target turn (phase 3, Annex B) → G5 an end-to-end tracker better than the re-tuned reference
(phase 4, Annex C). Iteration 0 builds the
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
decision and the seed; from spec 015 also the data's ancestry, the decision's plans and its frozen
models (`--model`, and `--network` for the hybrid's input chain; `tma-hybrid` records `inputs`). **Phase 3** (SRD Annex B,
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
Seeds 207–209 are reserved. **Phase 3 stopped at validation** (FR-007,
`experiments/20261029-p3a-val/validation.md`; model `experiments/20261029-p3a-models/`): after a
turn the network beats the IMM (range 0.77 [0.74, 0.81], course 0.60 [0.57, 0.64], gross −5.7 pp),
but G4-control fails on held course (course 11.1° [10.3, 11.9] > 10°, speed 1.60 kt [1.47, 1.72]
> 1 kt): it hedges towards a turn (speed −1.16 kt median bias). Seed 209's test split is unscored
and reserved. Annex B §B.5's second branch applies (publish; the owner decides on a new design).
Write-up: `site/blog/2026-10-29-phase-3.md`. **Phase 3b** (owner decision 2026-10-29, Annex B
§B.8, spec 011, decision 27 `experiments/20261029-p3b-decision/`): the same design with a
two-hypothesis output (`output_parameterisation: velocity_two_hypothesis`, schema 0.14.0: held
and turned estimates plus P(turned), supervised by `turnedLabel` from the stored truth course; the
more probable hypothesis is reported, never an average; `p_manoeuvre` on prediction rows); model
`lstm-two-hypothesis`, plan `configs/phase3/b` (push `train/p3b`), same seed-208 data and frozen
reference, G4 on fresh seed 210 (400,000). It is the last phase-3 attempt under Annex B. **Phase 3b stopped at validation** (FR-002, `experiments/20261030-p3b-val/validation.md`; model `experiments/20261030-p3b-models/`): after a turn it still beats the IMM (range 0.76, course 0.60, gross −6.4 pp) and held-course course passes (6.1°), but held-course speed fails, 1.15 kt [1.05, 1.25]. The turn flag false-alarms on ~30% of held rows (turned estimate biased −1.65 kt), and where it reports held the error is 1.00 kt. Seed 210 is unscored and reserved; Annex B §B.5's second branch applies (publish; the owner decides on an end-to-end tracker as a new project). Detection figures: `scripts/research/spec011-detection.mjs`. Write-up: `site/blog/2026-10-30-phase-3b.md`. **Phase 4** (SRD Annex C, decision 28, owner 2026-10-30; spec 012): an end-to-end learned tracker as a new project. Generator 0.5.0 (0–3 course changes, one speed change in 30%), G0 re-run, IMM/EKF re-tuned on validation over all G5 rows; two trackers trained from scratch and compared: T1 a learned-gain (KalmanNet-style) filter in a declared filter layer, T2 a pure recurrent tracker with per-output log-variance (NLL). Gate G5: σ = 1° rows at zig + 5/10/15/20 min, scenario-clustered bootstrap, 97.5% intervals per tracker; overall median range and course wholly below 1 × reference, settled rows (> 5 min after the last manoeuvre) range/course/speed wholly below 1.1 ×. If G5 fails, the owner decides the follow-on then (not fixed in advance). Fresh seeds from 211; 201–210 reserved. PR 2: generator 0.5.0 (schema 0.15.0: `TargetManoeuvre`, `ManoeuvreSpan`; `configs/phase4-ranges.json`, 20–60 min windows; the manoeuvre count is drawn once per scenario from its own stream and kept through redraws; `manoeuvre_start_index` = first manoeuvre's start, `manoeuvre_index` = last one's end); G0 passed on 0.5.0 (panel rounds 1–3, `experiments/20261030-g0-p4-r3/`, with `distribution.json` from `scripts/research/spec012-distribution.mjs`). Round 0 failed two tracker checks; they were re-scoped post hoc (recorded in `review.md`) and G0 gained `tracker-nis` (NIS through `immPredict`'s `onStep` hook, band [0.75, 1.3]) and a paired straight-leg ratio (limit 1.15). `tma-g4` and `velocity_two_hypothesis` training refuse 0.5.0 data; features rows come from `rowsFor(ranges)` (360 for phase 4). PR 3 (spec 012 research R1–R3, decision 29 `experiments/20261030-p4-decision/`): frozen reference `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8` (9.24% median range over G5 rows on seed-211 validation; EKF 9.72%); T1 `learned-gain-filter` (`configs/phase4/a`, push `train/p4a`, raw features) and T2 `lstm-gaussian` (`configs/phase4/b`, push `train/p4b`, `velocity_gaussian`, schema 0.16.0); `tma-g5` (validation diagnostic, or the gate with `--decision --plan --model`); G5 on fresh seed 212 (400,000) for each tracker carried by the validation rule. Seeds 211–212 are reserved. **Phase 4 stopped at validation** (decision 29's rule, `experiments/20261031-p4-val/validation.md`; models `experiments/20261031-p4a-models/`, `experiments/20261101-p4b-models/`): T2 beats the IMM overall (range 0.85 [0.82, 0.88], course 0.84) and matches it on settled range (0.97), but fails settled course 1.44 [1.37, 1.54] and settled speed 1.66 [1.56, 1.78]; T1 never converges in range (2.18 ×). T2's Gaussian head is calibrated (71% within 1 sd). Seed 212 is unscored and reserved; the owner decides the follow-on (Annex C §C.6). Write-up: `site/blog/2026-11-01-phase-4.md`. A chained training run must stay on one commit: features embed the data's generating commit, so a resume at a new commit is refused (T2 was restarted). **Phase 4b** (SRD Annex C §C.10, owner decision 30, spec 013): the tracker hybrid of the frozen IMM and frozen T2 (`trackerHybrid`, `tma-hybrid-track`: T2's range always, T2's course/speed where the courses differ by > 45°, θ chosen on validation by a declared margin criterion), judged by G5 unchanged on fresh seed 213 (plan `configs/phase4/h`, decision `experiments/20261101-p4h-decision/`; `tma-g5` binds frozen models by `model_digests`). **G5 passed for the hybrid** (panel rounds 1–2, `experiments/20261101-p4h-g5/`): overall range 0.862 [0.843, 0.878], course 0.904; settled range 1.022 [0.990, 1.060], course 0.980, speed 0.994. Not shown: before any target manoeuvre its range is 1.47 × the IMM's (6.0% vs 4.1%); against the EKF it fails settled course (1.44 ×) and speed (1.21 ×); batch least squares beats it on settled range; range and velocity come from different estimators (not one track state). Write-up: `site/blog/2026-11-01-phase-4b.md`. Seeds 211–213 are reserved. Follow-ups (schema 0.17.0): network prediction files record `model_weights_sha256` and hybrid files their `inputs` (estimator, SHA-256); on a test split `tma-g5` refuses a carried file that does not trace to a `--model`'s weights, directly or through inputs that are files given to the gate. `tma-g5`'s report adds settled rows before any manoeuvre and after one (reported, not gated). The hybrid's bearing-rate consistency is in `experiments/20261101-p4h-g5/bearing-rate.json` (`scripts/research/spec013-bearing-rate.mjs`). **Phase 4c** (SRD Annex C §C.11, owner decision 31, spec 014): the **fused tracker**, the frozen IMM with the frozen T2's range fused in as a log-range measurement (sd 4 × T2's stated sd, every 6 samples; `fusedPredict`, `tma-fuse-track`), one track state where 4b's hybrid had two estimators (though T2's range shares the bearings; k and M are an empirical correction). k and M were chosen on seed-211 validation from 18 variants (`experiments/20261102-fused-research/`; decision 31 says 12, corrected after the decision). Decision 31 (`experiments/20261102-p4f-decision/`, plan `configs/phase4/f`) judged it at G5 unchanged on fresh seed 214. **G5 passed for the fused tracker** (panel rounds 1–2, `experiments/20261102-p4f-g5/`; write-up `site/blog/2026-11-02-phase-4c.md`): overall range 0.824 [0.811, 0.837], course 0.947 [0.936, 0.960]; settled range 0.864, course 0.948, speed 0.897. Not shown: before any target manoeuvre it only matches the IMM (range 1.03 × [0.99, 1.07]); against the EKF it fails settled course (1.41 ×); the 4b hybrid is better on overall course (fused/hybrid 1.04 ×); its covariance is not calibrated (NEES median 1.1, where 3.36 is expected). Its implied bearing rate is as accurate as the IMM's (one state). Seeds 211–214 are reserved.
**Spec 015** (G5 bindings, no gate judged): on a test split `tma-g5` now (1) re-computes a seeded
200-scenario sample (seed 20261011) of the carried trackers and the reference from the settings
their names declare (`parseImmName`, `parseEkfName`, `parseFusedName`, `parseTrackerHybridName`,
each round-trip-checked) and refuses unless every stored line is byte-identical; a network's own
file is used as stored (bound by its weights digest); (2) refuses data not generated at or after
the commit that added the decision, frozen models included; (3) writes `scoring.json` (schema
0.18.0 `GateScoring`) and refuses a second G5 scoring of the same decision and seed anywhere under
`experiments/` unless `--repeat-of <earlier experiment>` (a reproduction; a G5 verdict without
`scoring.json` also refuses). `fusedPredict` skips rows with range ≤ 0 or a non-positive or
non-finite log-range sd (`usableRange`). Both committed G5 verdicts re-score with identical checks
(`specs/015-g5-binding/research.md`). **Spec 015 R5 follow-up, spec 016** (owner 2026-11-03): an
opt-in guarded (re-)initialisation for both trackers, `guardedInit` 1 or 2 (name suffix `-g1`/`-g2`,
`--guarded-init` on `tma-track` and `tma-fuse-track`). It refuses a batch fit within 100 m of
ownship or with an ill-conditioned QR factor, builds P₀ in square-root form, and at level 2
re-initialises from the last 60 samples first. Level 0 is every frozen reference, byte-identical;
re-freezing a guarded reference needs a decision record. On seed-211 validation (`experiments/20261103-guarded-init-val/`):
- **Level 1 is accuracy-neutral** (G5-row ratios 1.000 ± 0.003 for the IMM, the EKF and the fused
  tracker) and removes every non-PD IMM covariance (frozen: 21 steps in 6 of 10,000 scenarios).
  It reports no estimate on 0.07% more rows.
- **Level 2 is rejected.** It is 2–9% worse and still has non-PD steps.
- **Decision 32** (owner 2026-11-05, `experiments/20261105-guarded-ref-decision/`, SRD Annex C D7):
  from it on, the Annex C reference is `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1` (EKF reported:
  `ekf-sa0.03-p4-r8-g1`), with decision 29's tuning unchanged. Decisions 29–31 and their verdicts
  stand at level 0. Fresh seeds run from 215. **Phase 5** (SRD Annex C §C.12, spec 017,
owner 2026-11-05): manoeuvre detection, gate **G6**. It compares a detector built from frozen
models (no training) with a clipped CUSUM on the `-g1` IMM's innovations, at matched false alarms
(0.5 per quiet hour). Schema 0.19.0 adds detection files and `ChangeDecision.detector_thresholds`.
`tma-detect` scores; `tma-g6` calibrates on validation and judges a test split with spec 015's
bindings. **Phase 5 stopped at validation** (`experiments/20261105-p5-research/validation.md`):
- **Result.** T2's course change over 1 min detects 19.2% of course changes within 5 min,
  against the mean-shift CUSUM's 28.2% (−8.95 pp [−10.16, −7.73]). It was not carried, and seed
  215 was never generated.
- **The delay check is undefined** at that rate: every detector misses more than half the events.
- **Reported only.** From about 1 false alarm per hour, the learned detector catches more.
- **Next.** The owner decides the follow-on.

**Phase 6** (SRD Annex C §C.13, spec 018, owner 2026-11-06): calibrated uncertainty, gate **G7**.
- **Stated sds.** The IMM, and so the fused tracker, writes stated sds under the `-sd` name
  suffix (`--report-sd`; schema 0.20.0 `course_sd_rad`, `speed_sd_mps`). They come from the
  combined covariance by the delta method; the estimates are unchanged.
- **Recalibration.** Post hoc, per tracker and output: the 50% and 90% multipliers are quantiles of
  |error/sd| on seed-211 validation, frozen in decision 33 (`experiments/20261106-p6u-decision/`;
  plan `configs/phase4/u`, seed 215).
- **The gate.** Coverage within nominal ± 2 pp, and median 90% width below the `-g1` IMM's;
  `tma-g7`.
- **G7 on seed 215 is inconclusive** (panel rounds 1–2, `experiments/20261106-p6u-g7/`):
  - log-range 50% coverage is 48.32% [47.81, 48.82] against a 48% floor;
  - the other eight pass, with widths 0.73 / 0.95 / 0.89 × the IMM's;
  - coverage holds on the pooled row mix only: 67% before any manoeuvre, 38% after one;
  - 17% of course 90% intervals are vacuous;
  - the shortfall looks systematic, plausibly from reusing seed-211 validation.
- **The one re-score passes** (decision 34 `experiments/20261106-p6v-rescore-decision/`, plan
  `configs/phase4/v`, seed 216, 110,000 test scenarios; panel rounds 1–2,
  `experiments/20261106-p6v-g7/`; write-up `site/blog/2026-11-07-phase-6-rescore.md`). The verdict
  is final:
  - log-range 50% coverage is 48.62% [48.33, 48.91], and all nine checks pass;
  - widths are 0.73 / 0.94 / 0.89 × the IMM's;
  - the claim is pooled coverage within tolerance, not calibration. Log-range 50% is biased about
    1.5 pp low (both seeds pooled: ~48.5%); on settled rows it is 67% before any manoeuvre and 39%
    after one; 17% of course 90% intervals are vacuous; 27% of speed 90% lower bounds are below 0. A second look:
    false-pass risk ≤ ~5% over both; the pass judges the frozen multipliers, not the fitting.
- `tma-g7` streams rows (`g7Rows`, ~0.4 GB at 110,000 scenarios) and binds a re-score
  (`requireG7Rescore`: an inconclusive, non-re-score G7, a fresh seed, the same multipliers, names
  and models). Seeds 215–216 are reserved. The owner decides the follow-on.

**Phase 7** (SRD Annex C §C.14, spec 019, owner 2026-11-08): realistic bearing error. Frozen
trackers, with no training or re-tuning. The gate is G5's rules unchanged: the frozen
`-g1` fused tracker against the frozen `-g1` IMM.
- **Generator 0.6.0** (schema 0.21.0 `BearingErrorModel`, `configs/phase7-ranges.json`) adds a
  Gauss–Markov term (1.0°, 30 s) and a drifting bias (0.5°, 20 min) to σ > 0 bearings.
  - They come from the scenario's own stream (sub-index 2), so the geometry and white noise are
    0.5.0's.
  - A noise-free scenario has no bearing error.
  - The owner doubled the agent's first severity after the G0 panel noted it.
- **G0 passed on 0.6.0** (panel rounds 0–2, `experiments/20261108-g0-p7-r1/`). It adds the check
  `bearing-error-model`; the tracker checks keep white noise.
- **Plans** can give `dataset.fresh_test.ranges`, and the digest check binds the header to them.
- **`tma-model-predict`** treats 0.6.0 as 0.5.0 only when there is no bearing error
  (`EQUIVALENT_GENERATORS`), so T2 keeps seed 211's normalisation.
- **Validation on seed 217 carried it** (`experiments/20261108-p7-val/`): fused/IMM range
  0.777 and course 0.922.
- **Decision 35** (`experiments/20261108-p7-decision/`, plan `configs/phase4/w`) set G5 on seed
  218. Seeds 217–219 are reserved.
- **G5 passed** (panel rounds 1–2, `experiments/20261108-p7-g5/`; write-up
  `site/blog/2026-11-08-phase-7.md`): fused/IMM range 0.766 [0.755, 0.778], course 0.907; settled
  0.774 / 0.875 / 0.907.
- **Not shown:**
  - **Against T2.** T2 alone has lower range error: 12.1% against 13.2%, fused/T2 1.095. T2 is
    also the most robust, at 1.47 × its clean error against the IMM's 1.82 ×.
  - **Against classical methods on straight legs.** The EKF wins on settled course (1.27 ×) and
    speed, and batch least squares before any manoeuvre (7.3%, 2.2°).
  - **Against an adapted reference.** The IMM is frozen, not adapted to correlated error.
  - **Scale of the errors.** Every tracker degrades 1.5–2.1 ×.
  - **Consistency.** NIS, NEES and non-PD counts under correlated error were not measured.

  Baselines: `baselines.json` and `lsq.json` (`scripts/research/spec019-baselines.mjs`,
  `spec014-lsq.mjs`).

**Phase 8** (SRD Annex C §C.15, spec 020, owner 2026-11-10): re-tune the fusion's k and M under
realistic error. The gate would have been **G8**: G5, plus fused/T2 median range wholly below 1.
It is `tma-g5 --beat <network>` (schema 0.22.0 `ChangeDecision.beat_estimator`).
- **The grid.** 24 variants on seed 217 validation (`experiments/20261110-p8-research/`), with the
  selection pre-registered in `scripts/research/spec020-grid.mjs`.
- **Phase 8 stopped at validation.** No variant beats T2 on range: the best is k 3, M 1, at fused/T2
  1.014. Against the IMM, re-tuning improves range to 0.740 from 0.777.
- **Seeds.** Seed 220 was never generated; 220–221 stay reserved. Write-up:
  `site/blog/2026-11-10-phase-8.md`.

**Phase 9** (SRD Annex C §C.16, spec 021, owner 2026-11-12): an IMM with a bearing-bias state, under
G8's rules. The bias state is opt-in, `ImmParams.biasSdDeg`/`biasTauS` (name suffix `-b<sd>-tb<τ>`,
`tma-track --bias-sd --bias-tau`), and the 5-state IMM is byte-identical.
- **Phase 9 stopped at validation, as forecast** (`experiments/20261112-p9-research/`; 18 variants
  on seed 217). At best the candidate equals the frozen IMM (range 0.998) and is 1.37 × T2's range
  error.
- **Why.** A bearing bias is nearly unobservable here: the geometry rotates to absorb it.
- **Seeds.** 222–223 stay reserved, and seed 222 was never generated. Write-up:
  `site/blog/2026-11-12-phase-9.md`.

**Phase 10** (SRD Annex C §C.17, spec 022, owner 2026-11-12): the hybrid of T2's range with the
frozen fused tracker's velocity, θ 180.
- **The estimator.** `tma-hybrid-track --course-deg 180` builds it. It is judged by G8, with the
  fused tracker as `beat_estimator` (decision 38, `experiments/20261112-p10-decision/`, plan
  `configs/phase4/z`, seed 224).
- **Recomputation.** `tma-g5 --beat` re-computes the beaten file too.
- **G8 passed** (panel rounds 1–2, `experiments/20261112-p10-g8/`; write-up
  `site/blog/2026-11-12-phase-10.md`):
  - against the IMM: range 0.689 and course 0.895; settled 0.724 / 0.887 / 0.898;
  - against the fused tracker: range 0.908.
- **Mostly a replay.** The range is T2's, so the beat check repeats phase 7. Only the pairing is
  new.
- **Not shown:**
  - a gain over T2 on range;
  - overall course, where T2 is better (1.02 ×);
  - settled course and speed against the EKF;
  - one coherent state (kinematic gap of 18 kt);
  - stated uncertainty.

  The estimator to beat moved from T2 (phases 8–9) to the fused tracker.
- **Reported:** `baselines.json`, `lsq.json`, `coherence.txt` (`scripts/research/spec022-coherence.mjs`)
  and `convergence.json` (`spec022-convergence.mjs`).
- **Seeds 224–225** are reserved. The owner decides the follow-on.

**Phase 11** (SRD Annex C §C.18, spec 023, owner 2026-11-13): T2 retrained from scratch on
realistic-error data (`lstm-gaussian-re`, seed 226, phase-7 ranges, plan `configs/phase11/a`,
decision 39 `experiments/20261113-p11-decision/`), under G8 with the frozen T2 as the estimator to
beat.
- **Phase 11 stopped at validation** (`experiments/20261114-p11-val/validation.md`; model
  `experiments/20261113-p11a-models/`, best epoch 48 of 55). On seed 217, retrained/frozen T2 range
  is 1.021 [0.991, 1.052], so the carry rule fails. The other five points pass.
- **Retraining costs on white noise.** On the clean twin, retrained/frozen range is 1.287, and the
  retrained T2 is worse than the IMM there. Its smaller degradation (1.21 × against 1.52 ×) comes
  from starting worse. It helps only settled course (0.878 ×).
- **Seeds.** 226 is the training data; 227–228 were never generated and stay reserved. Write-up:
  `site/blog/2026-11-14-phase-11.md`. The owner decides the follow-on.
- Each T2 keeps its own normalisation: the frozen one seed 211's train split, the retrained one
  seed 226's.

Prediction files are streamed (`openPredictionStream`): a 40,000-scenario per-timestep file exceeds V8's string limit when joined. `tma-g2 --rescore-of <gate>` binds the frozen weights by digest in place
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
