# SRD: TMA via ML — TypeScript Proof of Concept

Oct 11, 2026 · @Ian Mayo

## 1. Purpose and scope

The project answers one question: can a neural network trained on high volumes of simulated bearings-only data produce usable target range, course and speed estimates? The answer is a go/no-go gate, not a product.

**In scope**

- A TypeScript/Node toolchain that generates mock ownship, target and bearing data at scale (10^5–10^6 scenarios).
- Two ML consumers of the same bearing data: an *instantaneous* model (solution now) and a *time-late* model (track over the window).
- A naive baseline and a classical bearings-only solver as yardsticks.
- Staged success gates (section 5) with a fail-fast decision at the end of each iteration.
- All data types defined once in LinkML, so the generator and model definitions port to Python (PyTorch/TF) or Java with identical types (section 9).

**Out of scope**

- Multi-target, clutter, data association, or sensor artefacts beyond Gaussian bearing noise and dropouts.
- Real or classified data; anything above OFFICIAL.
- Stone Soup integration (a later phase; the TS generator mimics its track and detection shapes so the swap is cheap).
- Performance tuning for runtime deployment — training throughput only needs to be adequate for experimentation.

## 2. Problem definition

Ownship holds a sequence of noisy bearings to a single target that moves at constant course and speed (up to G3; from phase 3 the target may make one course change, Annex B §B.2; from phase 4 up to three course changes and one speed change, Annex C §C.2). Ownship's own track is known exactly. The task is to recover the target's state from bearings alone.

**Frame and units.** Local flat-earth Cartesian (x east, y north, metres) centred on ownship's position at window start. Bearings are true, clockwise from north, in radians internally. Speeds in m/s, converted to knots only for reporting.

**Observability.** With a straight-line target, bearings from a single ownship leg do not determine range. Ownship therefore always performs a two-leg zig (a course change part way through the window), making the problem observable by construction. Observability still degrades with small zig angles and long ranges; the generator records both so results can be sliced by them.

**Two consumers of the same data**

| Variant | Input | Output | Analogy |
| --- | --- | --- | --- |
| Instantaneous | *All bearings from window start to t, for every t after the zig* | Target range, course, speed at *t* (and x, y derived) | Operator's current solution, scored as a curve of error vs time-since-zig |
| Time-late | Full bearing window | Target position at each timestep (or initial state + velocity) | Post-hoc track reconstruction |

Both variants consume identical scenario files; they share one feature layout and differ only in whether the model may look ahead in the window (section 4). The time-late variant has strictly more information per label, so it should score at least as well as the instantaneous one; if it does not, the pipeline is suspect.

## 3. Mock data generation requirements

The generator must produce scenarios fast enough that data volume is never the bottleneck: target ≥ 1,000 scenarios/second single-threaded in Node.

**Scenario parameters** (each sampled per scenario, ranges adjustable per iteration)

| Parameter | Iteration 1 range | Notes |
| --- | --- | --- |
| Window length | 10–40 min, sampled per scenario; 1 bearing / 10 s (60–240 samples) | Variable length from the outset; inputs padded to 240 and masked |
| Ownship speed | 5–15 kt | Constant within a leg |
| Ownship zig | Course change 30–90°, at 40–60% of window | Turn modelled as instantaneous in iteration 1, then rate-limited |
| Ownship zig, from iteration 3 | First zig at 40–60% of window, then a second zig 3–5 min after leg 2 starts; each turn crosses the line of sight, putting the target 30–90° on the other bow (shorter turn; median 143°) | Generator 0.3.0, Annex A lever B.2.1, spec 007; same turn rate (0.5–3°/s) for both turns; gate times still count from the end of the first turn, so zig + 5 min falls mostly during the second turn; redraws of second turns that do not fit skew windows long (p10 16.7 min) |
| Target manoeuvre, from phase 3 | One course change of 30–120°, rate-limited at 0.5–3°/s, between 2 min after ownship's first turn ends and 6 min before the window ends; 80% of scenarios manoeuvre, 20% hold course | Generator 0.4.0, Annex B §B.2, spec 010; speed constant through the turn; metadata gains `manoeuvre_index` and `manoeuvre_angle_rad`; gate G4 counts time from the end of the target's turn |
| Target manoeuvres, from phase 4 | 0–3 course changes (P = 0.2, 0.3, 0.3, 0.2), each as phase 3's; one speed change of ±2–6 kt at 0.05–0.2 kt/s in 30% of scenarios; manoeuvres ≥ 3 min apart, the first ≥ 2 min after ownship's first turn ends, the last ending ≥ 6 min before the window ends | Generator 0.5.0, Annex C §C.2, spec 012; gate G5 rows at zig + 5, 10, 15, 20 min, with settled rows > 5 min after the last manoeuvre |
| Target initial range | 2–20 km | Log-uniform so short ranges aren't under-represented |
| Target initial bearing | Uniform 0–360° | Relative to ownship at window start |
| Target speed | 3–20 kt | Constant |
| Target course | Uniform 0–360° | Constant up to G3; one change from phase 3 (above); may include closing and opening geometries |
| Bearing noise | Gaussian σ = 0.5°, 1°, 2° | σ stored per scenario |
| Dropouts | 0–10% of samples missing at random | Masked in the input tensor |

**Outputs per scenario**

- Ownship truth track: (t, x, y, course, speed) per sample.
- Target truth track: same fields.
- Observations: (t, bearing, valid flag).
- Metadata: seed, parameter draws, zig angle, mean range, noise σ — the slicing keys for evaluation.

**Non-functional**

- Deterministic from a 64-bit seed; the same seed reproduces the same scenario on any platform (use a seeded PRNG, not `Math.random`).
- Storage format: newline-delimited JSON for inspection plus a binary Float32 pack for training; a scenario must round-trip losslessly between the two.
- Schema versioned; every file carries the generator version so old datasets can be regenerated or rejected.
- Field names and shapes follow Stone Soup's `GroundTruthPath` / `Detection` conventions where sensible, so a later Python port can swap in Stone Soup as the generator.

**Splits.** Train / validation / test by scenario seed range, 80/10/10. A fourth *held-out geometry* set uses parameter ranges outside training (e.g. ranges 20–30 km) to measure extrapolation.

## 4. Model requirements

Both variants are sequence-to-sequence models over the same padded, masked bearing window; they differ only in whether the encoder may look ahead. The proof is about whether the signal is learnable, not about architecture search, so models stay small and Keras-plain.

**Shared input** (one row per 10 s timestep, padded to 240 rows)

| Channel | Encoding | Notes |
| --- | --- | --- |
| Bearing | sin, cos | Avoids the 359°→0° discontinuity |
| Ownship position | x, y in km from window-start origin | Section 2 frame |
| Ownship course | sin, cos | — |
| Ownship speed | m/s, scaled by a fixed constant | Normalisation constants are fixed per dataset version, computed from inputs only |
| Time | seconds since window start, scaled | Not normalised to window length, since windows vary |
| Valid | 1 if a bearing was observed, 0 for dropout | — |
| Mask | 1 inside the window, 0 for padding | Applied to encoder and loss |

Ownship state is supplied raw rather than pre-computed into bearing lines; whether the network can exploit it is part of what is tested. Derived features (bearing rate, bearing-line intercepts) are reserved for iteration 2 if raw features stall.

**Shared output** (one row per timestep, masked to the window)

| Quantity | Encoding | Loss term |
| --- | --- | --- |
| Range | log(range in km) | MSE — equalises relative error across 2–20 km |
| Course | sin, cos | MSE on the unit vector |
| Speed | m/s, scaled | MSE |
| Position | x, y in km, derived from range and bearing at each step | Reported, not trained on directly |

The loss is a weighted sum of the three terms, masked to valid window rows. For the causal variant the loss is additionally masked to timesteps after the zig, where the problem is observable; before the zig any prediction is guesswork and penalising it would only teach the prior.

**The two variants**

| Variant | Encoder | What the output at timestep t may use | Analogy |
| --- | --- | --- | --- |
| Instantaneous (causal) | Single-layer LSTM, 64–128 units | Bearings up to and including t | Operator's running solution |
| Time-late (non-causal) | Bidirectional LSTM, 64–128 units per direction | The whole window | Post-hoc track reconstruction |

The time-late variant has strictly more information at every timestep, so it must score at least as well as the causal one at every point on the error-vs-time curve. If it does not, the pipeline is suspect before any conclusion is drawn about ML.

**Controls.** Each variant has a non-recurrent control with the same input and output: a causal 1-D CNN for the instantaneous variant, an MLP over the flattened window for the time-late one. A recurrent model that cannot beat its control is not extracting sequential structure.

**TensorFlow.js constraints**

- `@tensorflow/tfjs-node` for training; `tfjs-node-gpu` optional, not assumed.
- Expect throughput roughly an order of magnitude below PyTorch; iteration-1 datasets are about 10^5 scenarios. ~~Each model trains for at most 6 hours wall-clock on a 4-core CPU~~ (amended 2026-10-11 from "under an hour", see spec 002 research R1; replaced 2026-10-17 by Annex A §B.4): training runs as chained jobs on CI with checkpoints after every epoch (AGENTS.md); there is no cap beyond the runners' limits, and every job's duration is recorded. Training stops on early stopping or `max_epochs`.
- Only layers with direct Keras equivalents (LSTM, Bidirectional, Conv1D, Dense, Masking), so a port to Keras or PyTorch is mechanical. From phase 4 a model may also contain a declared filter layer (constitution III, 1.3.0; Annex C §C.7), whose equations its algorithm note states exactly.
- Phase 4 (Annex C §C.4) adds two model variants: a learned-gain filter (a constant-velocity prediction and bearings-only update whose gain a recurrent network computes) and a pure recurrent tracker (position, velocity and a per-output log-variance each timestep).
- Models saved in the `tfjs` layers format plus a JSON manifest (hyperparameters, dataset seed, normalisation constants, generator version); every run is reproducible from manifest plus dataset.

## 5. Baselines, metrics and success gates

Success is staged: clear the naive baseline first, then approach classical-solver parity. Both are measured on the same test set with the same metrics.

**Baselines**

1. *Naive*: predict the training-set mean (log range, course vector, speed). Any model that cannot beat this has learned nothing.
2. *Classical*: batch least-squares bearings-only solver (Gauss-Newton on the constant-velocity target model, initialised from a coarse range grid). Implemented in TypeScript for iteration 1; an EKF is added as a second reference only if G3 is reached (G3 was reached 2026-10-28; the EKF is added by Annex B §B.3 as the primary reference for G4, with its process noise tuned on validation and frozen). This solver is also the sanity check on the generator: it must converge on noise-free data to within numerical precision.

**Metrics** (reported overall and sliced by range band, zig angle and noise σ)

| Metric | Definition |
| --- | --- |
| Range error | median and 90th percentile of \|r̂ − r\| / r |
| Course error | median and 90th percentile of angular difference, degrees |
| Speed error | median and 90th percentile, knots |
| Position error (time-late) | mean \|p̂ − p\| over the window, metres |
| Gross-error rate | fraction of scenarios with range error > 50% |

Medians and 90th percentiles rather than means: TMA failure modes are heavy-tailed and a mean hides them.

The instantaneous variant is scored at every timestep after the zig and reported as a curve of each metric against time-since-zig. Gate thresholds for it are applied at 5 minutes after the zig, except G2's speed threshold, which is applied at 10 minutes (amended 2026-10-11: at σ = 1° the classical solver's median speed error is 1.28 kt at 5 minutes and 0.61 kt at 10, so a 5-minute speed threshold of 1 kt would ask the model to beat the classical reference; spec 003 research R12); the full curve shows how fast the solution converges, which is the operationally interesting number.

**Gates**

| Gate | Criterion | Decision if failed |
| --- | --- | --- |
| G0 — pipeline | Classical solver recovers noise-free truth; naive baseline numbers reproduced | Fix the generator before any training |
| G1 — signal exists | Model median range error < 50% of naive baseline's, on both variants (95% interval wholly below; a shuffled-label failure voids the evidence, a time-late consistency failure makes it inconclusive, except as decided 2026-10-12 below; amended 2026-10-11. Amended 2026-10-12, after the first G1 result and before the continuation run: a variant that failed after stopping on the wall-clock cap with fewer epochs than the other may be continued once from its committed weights to the same epoch budget, all else unchanged; the first result stays recorded and a second fail is final. Decided by the user on 2026-10-12 before that run: if both ratio intervals then lie wholly below 0.5 and the shuffled-label check passes, G1 passes even if the time-late consistency check fails, with "time-late not shown better than instantaneous" recorded beside the pass) | Stop: ML not extracting the signal; report and close |
| G2 — useful | Median range error < 20%, course < 10° (5 min after the zig), speed < 1 kt (10 min after the zig) at σ = 1° | Iterate features/architecture once; if still failed, stop |
| G3 — classical parity (stretch) | Model within 1.2× classical solver on every metric, and lower gross-error rate | Not a stop condition; defines the bar for the next phase |
| G4 — better than the EKF after a turn (phase 3, Annex B §B.4) | On manoeuvring scenarios at manoeuvre + 5 min, σ = 1°: the network's median range and course error below the tuned-turn EKF's (paired 95% interval wholly below 1) and its gross-error rate not above the EKF's; and no regression from G2 on held-course scenarios. One re-score on a larger fresh seed if inconclusive, then fail | Not a stop condition; Annex B §B.5 decides the follow-on |
| G5 — an end-to-end tracker better than the re-tuned reference (phase 4, Annex C §C.5) | σ = 1° rows at zig + 5, 10, 15, 20 min, scenario-clustered paired bootstrap, 97.5% intervals per tracker (two trackers): median range and course error over all rows wholly below 1 × the reference's, and on settled rows (> 5 min after the last manoeuvre) range, course and speed wholly below 1.1 ×. One re-score on a larger fresh seed if inconclusive | Not a stop condition; Annex C §C.6 (incremental if passed; otherwise the owner decides when the result is known) |

G3 is the interesting outcome either way: parity on clean data would be unremarkable, but a lower gross-error rate on noisy or near-unobservable geometries is the case for ML over classical methods.

## 6. Architecture and tooling

&#91;embedded content: experiment pipeline · 6 stages\]

Every stage is a separate CLI command reading and writing files, so any one can be re-run or replaced (e.g. the generator by Stone Soup, training by PyTorch) without touching the rest.

**Stack**

- Node 22 LTS, TypeScript 5 strict, ESM. `pnpm` workspace monorepo.
- `@tensorflow/tfjs-node` for training and inference; `vitest` for tests; runtime validation of every file read via validators generated from the LinkML schema (LinkML → JSON Schema → `zod`).
- Seeded PRNG (`seedrandom` or a hand-rolled PCG) — a hard requirement for reproducibility.
- Results written as CSV + JSON; plotted with a small Node script or notebooks (`tslab`), whichever the team finds faster.

**Repository layout**

```
schema/       LinkML source of truth for all data types
packages/
  types/      generated TS types + zod validators (CI-generated, committed)
  sim/        ownship + target motion, bearing observer
  data/       batch generation CLI, NDJSON ↔ Float32 pack, splits
  features/   window → tensor for each variant, normalisation stats
  models/     tfjs model definitions + training CLI + manifests
  classical/  naive baseline, least-squares bearings-only solver
  eval/       metrics, slicing, gate checks, report generation
  demos/      browser apps (tfjs in-browser): the engagement and model viewer (Annex A, spec 006)
experiments/  one folder per run: manifest, metrics, plots
site/         GH Pages content: welcome, blog, glossary, data dictionary, algorithms
.github/      CI, schema generation, PR preview + GH Pages deploy workflows
```

**Portability rules** (so the later Python/Java port is mechanical)

- No TS-only cleverness in `sim` or `features`: plain functions over numeric arrays, no classes with hidden state.
- Every data type (scenario, track, observation, feature tensor layout, model manifest, metrics record) is defined once in LinkML under schema/. TypeScript types, JSON Schema and the data dictionary page are generated from it in CI; hand-written types for these are forbidden. The same source later generates Pydantic and Java classes, so a port starts from identical types.
- Model definitions use only layers with direct Keras equivalents; hyperparameters live in the manifest, not in code.
- Each package has a golden-file test: fixed seed in, byte-identical output out. A port passes when it reproduces the golden files.

## 7. Experiment plan

Four one-week iterations, each ending at a gate. Iteration 0 is infrastructure; a failed G1 at the end of iteration 1 ends the project with a short write-up. Each gate verdict is taken by the agent review panel (section 8) against the metrics in section 5. Borderline numbers are not settled by a casting vote: an inconclusive interval allows one re-score on a larger fresh-seed test set, then fails (amended 2026-10-11).

| Iteration | Builds | Gate | Exit if failed |
| --- | --- | --- | --- |
| 0 — Pipeline | Generator, store, classical solver, naive baseline, eval harness, golden tests | G0 | Fix; do not start training on an unverified generator |
| 1 — Signal | Both variants on 10^5 clean scenarios (σ = 0.5°, no dropouts) | G1 | Stop and report |
| 2 — Noise | Same models on σ = 1–2°, 10% dropouts; one round of feature/architecture changes | G2 | One more iteration allowed, then stop (amended 2026-10-15, after iteration 2b's validation result and before its test scoring: a second extra iteration, 2c, is allowed, combining the two levers each shown to move speed on validation, a speed-weighted loss (2b) and model capacity (spec 003 research R20), judged on a fresh test split; then stop. The hyperparameter cap stands: 2c is one configuration, chosen from those two measured levers, not a search. Amended 2026-10-17 by Annex A: the stop was an effort-budget rule and is lifted; after 2c, Annex A Part B: further iterations at the owner's discretion, one pre-registered lever each, judged on fresh seeds) |
| 3 — Parity | 10^6 scenarios, held-out geometry set, classical comparison by slice | G3 | Not a stop; result feeds the next-phase decision |
| Phase 3 — Manoeuvre (Annex B) | Generator 0.4.0 (one target course change), G0 re-run, EKF reference tuned on validation, one carried instantaneous model on a fresh seed | G4 | Not a stop; Annex B §B.5 decides the follow-on, fixed in advance |
| Phase 4 — Tracker (Annex C) | Generator 0.5.0 (0–3 course changes, one speed change), G0 re-run, re-tuned references, a learned-gain filter and a pure recurrent tracker on a fresh seed | G5 | Not a stop; Annex C §C.6 |

**Each iteration produces**

- An `experiments/<id>/` folder: manifest, dataset seeds, metrics CSV, gate verdict.
- A blog post on the project site with the sliced metrics, an interactive results review, and the gate decision taken (section 9).
- No model is reported without its naive and classical numbers on the same test set beside it.

**Working pattern.** Infrastructure is front-loaded into iteration 0 so later iterations are mostly configuration changes. ~~Hyperparameter search is capped at a handful of runs per iteration~~ (replaced 2026-10-17 by Annex A §B.3): any number of configurations may be trained, but what is scored on a test split is declared, with its forecast, in a decision record committed before it is trained; the question is still whether the signal is there, not how good the best possible model is.

## 8. Risks, assumptions and decisions

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Model learns the generator's parameter priors rather than geometry (e.g. "range is usually \~8 km") | High | Log-uniform ranges, held-out geometry set, and the G1 criterion is relative to the naive baseline precisely to expose this |
| Classical solver is weak, making G3 parity look easy | Medium | Validate the solver on noise-free data and against published Gauss-Newton results; add EKF as a second reference |
| tfjs-node training too slow for 10^6 scenarios | Medium | Iteration 3 may be the trigger to port training to PyTorch early; the generator and eval stay in TS |
| Instantaneous-zig and constant-velocity target are so simplified that success doesn't transfer | High (but accepted) | This is the point of a proof: later phases add turn rates, target manoeuvres and Stone Soup realism |
| Normalisation leaks truth (e.g. scaling by true range) | Medium | Normalisation stats computed from inputs only; a leakage test trains on shuffled labels and must score at naive-baseline level |

**Assumptions**

- Ownship navigation is exact; only bearings carry noise.
- Bearings are available at a fixed cadence; the sensor has no field-of-view limits.
- A single target per scenario; no false detections.

**Decisions taken** (11 Oct 2026)

- Window length is sampled per scenario, 10–40 min; models take variable-length, masked input from iteration 1.
- The instantaneous model is scored at every timestep after the zig and reported as an error-vs-time curve; gates use the 5-minute point (G2 speed: the 10-minute point, amended 2026-10-11).
- Batch least-squares is the only classical reference up to G3; an EKF is added only if G3 is reached (added in phase 3, Annex B §B.3).
- Gate verdicts are taken by an agent review panel (amended 2026-10-11; replaces the team review): independent AI reviewers with distinct specialities review the evidence, their findings are fixed or answered, and they are re-invited until all approve. No human sign-off is required.

**Decisions taken** (17 Oct 2026, Annex A)

- Decision 21: the effort budget is lifted; failing G2 no longer ends the project. Further work follows Annex A: the engagement and model viewer first (Part A), then pre-registered levers (Part B).
- Viewer: inference in the browser on the committed weights (D1); bearing-window trimming deferred (D2); every gate's carried pair offered by default (D3).
- Decision 22 (Annex A D4): the realism check is recorded (Annex A §A.7), and the first Part B lever is observability in the data. Iteration 3 (spec 007) adds a second zig, with both turns across the line of sight, keeps the first zig's timing, and is judged on fresh seed 204.
- Decision 23 (Annex A D5, 2026-10-22): iteration 3 stopped at validation (LSTM speed 1.10 kt). Iteration 4 (spec 008) combines two Part B levers: velocity outputs (B.2.2) and the derived feature set (B.2.3), on iteration 3's three-leg problem, judged on fresh seed 205. Two levers at once, because removing the speed bias alone is forecast to reach only about 1.0 kt (spec 008 R1).
- Decision 24 (Annex A D6, 2026-10-27): G2 passed on the iteration-4 re-score (seed 206). The owner chose G3, first through the per-leg fit (B.2.3). Research showed it gives no usable range rate on the young legs at the gate points (spec 009 R1), so the owner chose the hybrid (B.2.6). A network-initialised solver reproduces classical (R2): classical's gross errors are least-squares optima far from the truth, not missed basins. So iteration 5 (spec 009) judges G3 for a disagreement switch, reported as a hybrid and not as "a network alone": classical's estimate, or the frozen iteration-4 LSTM's where classical fails or the two ranges differ by more than 50%. It is judged on fresh seed 207 (20,000 test scenarios), with every median and P90 against 1.2 × classical and the gross-error rate against classical's.

**Decisions taken** (28 Oct 2026, Annex B)

- Decision 25 (Annex B D1–D4): G3 passed for the hybrid on seed 207 (iteration 5). Phase 3 tests the one place a learned estimator has an in-principle advantage: a target that manoeuvres. Generator 0.4.0 adds one target course change (80% of scenarios); an EKF, tuned on validation and frozen, is the reference; gate G4 asks the network alone to beat the tuned-turn EKF on range and course five minutes after the turn, without regressing on held-course scenarios. The owner set that as the success bar. The follow-on for each outcome is fixed in advance (Annex B §B.5): incremental if G4 passes (manoeuvre detection, learned uncertainty, realistic bearing error), a publish-and-decide if it fails.

**Decisions taken** (30 Oct 2026, Annex C)

- Decision 28 (Annex C D1–D4): phases 3 and 3b stopped at validation (G4 not met: better than the tuned IMM after a turn, worse on held course). The owner chose the end-to-end learned tracker that Annex B §B.5 names as a separate project: two trackers (a learned-gain filter and a pure recurrent tracker), compared on generator 0.5.0 (0–3 course changes and an occasional speed change), against re-tuned references, at gate G5 (better overall, at most 10% worse on settled rows). If G5 fails, the follow-on is decided when the result is known.

## 9. Development practice and public site

The repository is public on GitHub from day one; nothing above OFFICIAL enters it, and the mock data has no real-world provenance. The project's public face is a GH Pages site that grows with every PR.

**Typing discipline**

- LinkML under `schema/` is the single source of truth for every data type. CI regenerates `packages/types/` (TS interfaces, JSON Schema, `zod` validators) and fails the build if the committed output is stale.
- TypeScript `strict` and `noUncheckedIndexedAccess`; no `any` outside generated code. Tensor shapes are recorded in the LinkML description of each feature type, since TF.js cannot type them.
- LinkML's generator toolchain is Python; it is a dev dependency only (managed with `uv`), not a runtime one.

**PR-based workflow**

1. Every change lands via a PR against `main`; no direct pushes.
2. A PR that adds a concept, data type, algorithm or result also adds or updates the matching page under `site/` (glossary entry, data dictionary regeneration, algorithm note, or blog post). The PR template carries a checklist for this; reviewers may block on a missing page.
3. CI on each PR: lint, typecheck, unit and golden-file tests, schema regeneration check, site build.
4. On merge, the site deploys to the `gh-pages` branch.

**Site contents**

| Section | Content | Source |
| --- | --- | --- |
| Welcome | Aspiration, the question being tested, the plan and current gate status | Hand-written; gate status pulled from the latest `experiments/` verdict |
| Blog | Dated posts per iteration or notable PR: interactive demonstrators, new maths, implementation decisions | One Markdown file per post under `site/blog/` |
| Glossary | TMA and ML terms as used here (ownship, zig, observability, time-late, gate) | Hand-written, alphabetical |
| Data dictionary | Every LinkML class and slot with descriptions, units and ranges | Generated from `schema/` by `gen-markdown`; never hand-edited |
| Algorithms | Reference pages for the generator, feature extraction, each model variant, naive baseline, least-squares solver | Hand-written, with formulae; linked from the glossary |

**PR preview apps**

- A PR that produces something viewable (a results review, or a playable demo of training or inference) builds a static browser app under `packages/demos/` and deploys it to `gh-pages` at `/pr/N/`.
- A bot comment on the PR links to the preview and is updated on every push; the preview is removed when the PR closes.
- Demos run TF.js in the browser against models exported from `experiments/`, so a reviewer can watch training on a small dataset or step through inference on held-out scenarios without cloning the repo.
- Results-review apps read the run's metrics CSV and plot the error-vs-time-since-zig curves and sliced metrics from section 5.

**Tooling decisions** (11 Oct 2026)

- Site: Docusaurus — blog and docs out of the box; demos embed as React components in MDX pages. LinkML's `gen-markdown` output is copied into the docs tree by CI.
- PR previews: deployed to `gh-pages` under `/pr/N/` by a workflow on each push; a second workflow deletes the folder when the PR closes, keeping the branch from bloating.
- Open: confirm in iteration 0 whether LinkML's TypeScript generator is adequate or whether TS types and `zod` validators are better derived from its JSON Schema output.

## Annexes

- [Annex A: Engagement viewer and phase 2](SRD-annex-A.md) (2026-10-17): the effort budget is
  lifted; an interactive engagement and model viewer is built and verified first, then further
  pre-registered attempts at G2 at the owner's discretion. Accepted 2026-10-17; its §B.4
  amendments are applied above (§4, §6, §7, §8).
- [Annex B: Phase 3, manoeuvring targets and gate G4](SRD-annex-B.md) (2026-10-28): after G3, the
  target may make one course change; an EKF is the reference; G4 asks the network alone to beat
  the tuned EKF after the turn. The follow-on for each outcome is fixed in advance. Accepted
  2026-10-28; its §B.6 amendments are applied above (§2, §3, §4, §5, §7, §8).
- [Annex C: Phase 4, end-to-end learned trackers and gate G5](SRD-annex-C.md) (2026-10-30): after
  phase 3 closed, two learned trackers (a learned-gain filter and a pure recurrent tracker) on
  targets with up to three turns and a speed change, judged against re-tuned references at G5.
  Accepted 2026-10-30; its §C.7 amendments are applied above (§2, §3, §4, §5, §7, §8).
