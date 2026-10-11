# Feature Specification: Iteration 0 — Verified Experiment Pipeline (Gate G0)

**Feature Branch**: `001-iteration-0-pipeline`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Iteration 0 of the SRD: generator, store, classical solver, naive baseline,
eval harness and golden tests, so that gate G0 can be judged before any training starts."

**SRD trace**: §2 (problem, frame), §3 (data generation), §4 shared input/output layout, §5 (baselines,
metrics, G0), §6 (pipeline, portability), §7 iteration 0, §9 (typing, PR workflow, site).

## User Scenarios & Testing *(mandatory)*

Actors: the **researcher** (runs experiments and judges gates), the **reviewer** (reads PRs and the project
site), and a future **porter** (re-implements stages in Python or Java).

### User Story 1 - Generate reproducible scenario datasets (Priority: P1)

The researcher asks for a dataset of N bearings-only scenarios from a seed and a parameter range set. They
receive train / validation / test / held-out-geometry files containing ownship truth, target truth,
noisy bearing observations and per-scenario metadata. Re-running with the same seed yields identical files.

**Why this priority**: every later stage, and every gate, consumes this data. Nothing else is testable
without it.

**Independent Test**: generate a small dataset twice from the same seed on two machines and compare
byte-for-byte; inspect one scenario by eye and confirm geometry (two-leg ownship, straight-line target,
bearings consistent with positions).

**Acceptance Scenarios**:

1. **Given** a seed and the iteration-1 parameter ranges, **When** the researcher generates 1,000
   scenarios, **Then** each scenario has a window of 10–40 min at one bearing per 10 s, a single ownship
   zig of 30–90° at 40–60% of the window, a constant-velocity target, and metadata recording seed,
   parameter draws, zig angle, mean range and noise σ.
2. **Given** the same seed and parameters, **When** generation is repeated, **Then** the output is
   byte-identical.
3. **Given** a generated dataset, **When** it is converted from the inspection format to the training
   format and back, **Then** every scenario round-trips losslessly.
4. **Given** a dataset written by a different schema or generator version, **When** any stage reads it,
   **Then** the stage refuses it with a message naming both versions.
5. **Given** a seed range, **When** splits are produced, **Then** train / validation / test are 80/10/10 by
   seed and a held-out-geometry set uses parameter ranges outside training (e.g. 20–30 km range).

---

### User Story 2 - Verify the generator with a classical solver (Priority: P1)

The researcher runs the classical batch least-squares bearings-only solver over a dataset and gets, per
scenario, an estimated target range, course and speed. On noise-free data it recovers truth to numerical
precision, which is the first half of G0.

**Why this priority**: the SRD forbids training on an unverified generator. This is the check that the
generator's geometry, frame and units are right, and it is the yardstick for G3.

**Independent Test**: run the solver on a noise-free, dropout-free dataset and confirm every scenario's
solution matches truth within tolerance; run it on noisy data and confirm errors grow with σ.

**Acceptance Scenarios**:

1. **Given** noise-free scenarios, **When** the solver runs, **Then** every scenario's estimated target
   state matches truth to within numerical tolerance.
2. **Given** scenarios with σ = 1°, **When** the solver runs, **Then** it returns an estimate for every
   scenario or an explicit non-convergence flag — never a silent wrong answer.
3. **Given** a scenario whose geometry is near-unobservable (small zig, long range), **When** the solver
   runs, **Then** the result and its convergence status are recorded so it can be sliced in evaluation.

---

### User Story 3 - Score any estimator against baselines and judge G0 (Priority: P2)

The researcher points the evaluation harness at a test set and one or more prediction files (naive
baseline, classical solver, later the ML models). The harness reports the SRD §5 metrics overall and by
slice, writes them to an experiment folder, and records a G0 verdict.

**Why this priority**: it turns US1 and US2 into a gate decision, and every later iteration reuses it
unchanged.

**Independent Test**: evaluate the naive baseline twice and confirm identical numbers; evaluate the
classical solver on noise-free data and confirm G0 passes; corrupt one prediction and confirm the metrics
move.

**Acceptance Scenarios**:

1. **Given** a training set, **When** the naive baseline is built, **Then** it predicts the training-set
   mean log range, mean course vector and mean speed for every test scenario.
2. **Given** predictions and truth, **When** evaluation runs, **Then** it reports median and 90th
   percentile range error (relative), course error (degrees), speed error (knots), and gross-error rate
   (range error > 50%), overall and sliced by range band, zig angle and noise σ.
3. **Given** a time-resolved prediction, **When** evaluation runs, **Then** it reports each metric as a
   curve against time-since-zig and the value at 5 minutes after the zig.
4. **Given** a completed evaluation, **When** the researcher inspects `experiments/<id>/`, **Then** it
   contains the manifest, dataset seeds, metrics table and a gate verdict (pass / fail with reasons).
5. **Given** any report, **When** a model's numbers are shown, **Then** the naive and classical numbers
   on the same test set appear beside them.

---

### User Story 4 - Model-ready input and output layout (Priority: P2)

The researcher converts scenarios into the fixed per-timestep input layout and target layout defined in
SRD §4, padded to 240 rows with validity and window masks, using normalisation constants computed from
inputs only.

**Why this priority**: iteration 1 starts training immediately after G0; the layout must exist and be
tested now so iteration 1 is configuration, not infrastructure.

**Independent Test**: convert a known scenario and check each channel by hand (bearing as sin/cos,
ownship position in km, masks); confirm normalisation constants do not change when truth labels are
shuffled.

**Acceptance Scenarios**:

1. **Given** a scenario of 60–240 samples, **When** it is converted, **Then** the result has 240 rows,
   window mask 1 inside the window and 0 in padding, and valid flag 0 at dropouts.
2. **Given** a dataset, **When** normalisation constants are computed, **Then** they depend only on input
   channels and are stored with the dataset version.
3. **Given** a scenario, **When** targets are produced, **Then** each row holds log range (km), course
   as sin/cos, and scaled speed, plus a mask marking post-zig rows.

---

### User Story 5 - Reviewable, portable project (Priority: P3)

The reviewer opens any PR and sees all checks pass, and can read the project site: welcome page with
current gate status, glossary, generated data dictionary, and algorithm notes for the generator, feature
layout, naive baseline and least-squares solver. The porter can find every data type in one schema and a
golden file per stage to reproduce.

**Why this priority**: required by the constitution and SRD §9, but G0 can be judged without it.

**Independent Test**: open a PR that changes a schema type without regenerating outputs and confirm the
checks fail; build the site and confirm the data dictionary lists every type.

**Acceptance Scenarios**:

1. **Given** a PR, **When** checks run, **Then** lint, type checking, unit tests, golden-file tests,
   schema-regeneration check and site build all run and must pass.
2. **Given** a merged PR, **When** deployment runs, **Then** the public site updates.
3. **Given** the schema, **When** the site is built, **Then** the data dictionary is generated from it
   and lists every type with description, units and ranges.
4. **Given** any pipeline stage, **When** its golden test runs with the fixed seed, **Then** output is
   byte-identical to the committed golden file.

### Edge Cases

- Target passes very close to ownship (range → 0): bearings change rapidly; generator must not produce
  NaN or wrap errors, and the solver must not divide by zero.
- Bearings near 0°/360°: no discontinuity in observations, errors or course-difference metrics.
- Dropouts remove samples around the zig, or 10% dropouts cluster: scenario remains valid; evaluation still
  runs.
- Shortest window (10 min) with zig at 40%: only ~6 min post-zig; the 5-minute gate point must still be
  defined (or the scenario explicitly excluded with a count reported).
- Course error wraps (e.g. 359° vs 1° = 2°, not 358°).
- Solver fails to converge: recorded as such, counted in gross-error rate, never dropped silently.
- Dataset file truncated or corrupted: reader fails loudly naming the file and record.

## Requirements *(mandatory)*

### Functional Requirements

**Generation**

- **FR-001**: The generator MUST produce single-target scenarios in the SRD §2 frame (flat earth, x east,
  y north, metres; bearings true, clockwise from north; speeds m/s internally).
- **FR-002**: The generator MUST sample per scenario the parameters of SRD §3 (window 10–40 min at
  1 bearing / 10 s; ownship 5–15 kt; one zig 30–90° at 40–60% of window, instantaneous; target initial
  range 2–20 km log-uniform; initial bearing and target course uniform 0–360°; target speed 3–20 kt;
  bearing noise σ ∈ {0.5°, 1°, 2°} or zero; dropouts 0–10%), with ranges configurable per run.
- **FR-003**: Each scenario MUST contain ownship truth, target truth (t, x, y, course, speed), observations
  (t, bearing, valid flag) and metadata (seed, parameter draws, zig angle, mean range, noise σ).
- **FR-004**: Generation MUST be fully determined by a 64-bit seed and MUST be byte-identical across runs
  and platforms.
- **FR-005**: The generator MUST sustain at least 1,000 scenarios per second on a single thread on a
  developer laptop.
- **FR-006**: Datasets MUST be stored in a human-inspectable line-per-scenario format and a compact binary
  training format, with lossless round-trip between them.
- **FR-007**: Every dataset file MUST carry schema and generator versions; readers MUST reject mismatches.
- **FR-008**: The system MUST produce train/validation/test splits (80/10/10 by seed range) and a
  held-out-geometry set with parameter ranges outside training.
- **FR-009**: Field names and shapes MUST follow Stone Soup ground-truth-path and detection conventions
  where sensible.

**Model-ready layout**

- **FR-010**: The system MUST convert each scenario to the SRD §4 input layout (bearing sin/cos; ownship
  x, y in km; ownship course sin/cos; scaled ownship speed; scaled time; valid flag; window mask), padded
  to 240 rows.
- **FR-011**: The system MUST produce the SRD §4 target layout per row (log range in km; course sin/cos;
  scaled speed; derived x, y) with a post-zig mask.
- **FR-012**: Normalisation constants MUST be computed from inputs only and stored with the dataset version.

**Baselines**

- **FR-013**: The system MUST provide a naive baseline predicting training-set means (log range, course
  vector, speed).
- **FR-014**: The system MUST provide a batch least-squares bearings-only solver (Gauss-Newton on a
  constant-velocity target, initialised from a coarse range grid) that reports estimate and convergence
  status per scenario, and can produce estimates at each post-zig timestep using only bearings up to that
  time.

**Evaluation and gate**

- **FR-015**: The evaluation harness MUST compute the SRD §5 metrics (median and P90 relative range error,
  course error in degrees, speed error in knots, gross-error rate; mean position error for time-resolved
  tracks) overall and sliced by range band, zig angle and noise σ.
- **FR-016**: For time-resolved predictions the harness MUST report each metric against time-since-zig and
  at the 5-minute point.
- **FR-017**: Each run MUST write `experiments/<id>/` containing manifest, dataset seeds, metrics table and
  gate verdict.
- **FR-018**: The harness MUST decide G0: PASS only if the classical solver recovers noise-free truth
  within tolerance on every scenario and the naive-baseline numbers reproduce exactly on re-run.
- **FR-019**: Any report of an estimator MUST include naive and classical results on the same test set.

**Engineering**

- **FR-020**: Every data type above MUST be defined once in the project schema; all other type
  definitions MUST be generated from it.
- **FR-021**: Each stage (generate, convert, solve, baseline, evaluate) MUST be runnable independently,
  reading and writing files.
- **FR-022**: Each stage MUST have a golden-file test: fixed seed in, byte-identical output out.
- **FR-023**: PR checks MUST run lint, type checking, unit and golden tests, schema-regeneration check and
  site build; merges to `main` MUST deploy the site.
- **FR-024**: The site MUST include welcome (with current gate status), glossary, generated data
  dictionary, and algorithm notes for the generator, input layout, naive baseline and least-squares solver.

### Key Entities

- **Scenario**: one run of ownship vs target over a window; owns ownship track, target track,
  observations and metadata; identified by seed.
- **Track**: time-ordered states (t, x, y, course, speed) of one platform.
- **Observation**: one bearing at time t with a valid flag (false = dropout).
- **Scenario metadata**: seed, parameter draws, zig angle, mean range, noise σ, versions — the slicing keys.
- **Dataset**: a set of scenarios with split label, seed range, versions and normalisation constants.
- **Feature window**: the padded 240-row input layout plus target layout and masks for one scenario.
- **Prediction**: an estimator's output per scenario (and optionally per timestep), with convergence status.
- **Metrics record**: metric values for one estimator, overall and per slice.
- **Experiment manifest**: run id, dataset seeds, versions, estimator settings, gate verdict.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On 10,000 noise-free scenarios, the classical solver's range, course and speed match truth
  to within 0.1% relative range, 0.1° and 0.01 kt on 100% of scenarios.
- **SC-002**: A 10^5-scenario dataset can be generated in under 2 minutes on a developer laptop
  (≥ 1,000 scenarios/s single-threaded).
- **SC-003**: Two generations from the same seed on different machines are byte-identical (100%).
- **SC-004**: 100% of scenarios round-trip between storage formats without loss.
- **SC-005**: Naive-baseline metrics are identical across two independent runs.
- **SC-006**: A researcher can go from a clean checkout to a G0 verdict in `experiments/` with no more
  than five commands and under 15 minutes at 10^5 scenarios.
- **SC-007**: Every pipeline stage has a passing golden-file test; every PR runs all checks.
- **SC-008**: The public site shows the G0 verdict and documents every data type and baseline algorithm.

## Assumptions

- Ownship navigation is exact; only bearings carry noise; single target, no false detections; sensor has
  no field-of-view limits (SRD §8).
- Ownship turn is instantaneous in iteration 0; rate-limited turns come later.
- Noise-free scenarios (σ = 0, no dropouts) are a valid generator configuration used only for G0.
- "Numerical tolerance" for G0 is as set in SC-001; it can be tightened in planning if the solver
  achieves better.
- For scenarios where the 5-minute post-zig point lies outside the window, they are excluded from the
  5-minute gate figure and the exclusion count is reported.
- No ML model is built in this feature; the input/output layout is built and tested only.
- The question of LinkML's TypeScript generator vs deriving types from its JSON Schema (SRD §9, open) is
  resolved during planning.
- PR preview apps (SRD §9) are deferred to iteration 1, when there is something to preview.
