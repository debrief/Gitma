# Feature Specification: Iteration 1 — Is the Signal Learnable? (Gate G1)

**Feature Branch**: `002-iteration-1-signal`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Iteration 1 of the SRD: train both model variants on 10^5 clean scenarios
and judge G1."

**SRD trace**: §2 (two consumers), §4 (models, controls, TF.js constraints), §5 (G1, metrics), §7
(iteration 1), §8 (risks: prior-learning, leakage), §9 (blog post, results review, PR previews).
Builds on spec 001 (data, features, baselines, evaluation, G0).

## User Scenarios & Testing *(mandatory)*

Actors: the **researcher** (trains models and judges the gate), the **reviewer** (reads PRs, the site
and preview apps), the **team** (takes the G1 decision; Doc has the casting vote).

### User Story 1 - Train both model variants reproducibly (Priority: P1)

The researcher trains the instantaneous (causal) model and the time-late (non-causal) model on a
10^5-scenario clean dataset (σ = 0.5°, no dropouts) and gets, for each, a saved model plus a
manifest from which the run can be repeated exactly.

**Why this priority**: without trained models there is nothing to judge; this is the core question
of the whole project.

**Independent Test**: train each variant on a small dataset twice from the same manifest and confirm
identical saved weights; confirm training on 10^5 scenarios finishes within the time budget.

**Acceptance Scenarios**:

1. **Given** the iteration-1 dataset and its feature files, **When** the researcher trains the
   instantaneous variant, **Then** a model and manifest are saved, and the manifest records
   hyperparameters, dataset seed and split digests, normalisation constants, generator and schema
   versions, and the random seed used for initialisation and batching.
2. **Given** the same, **When** the researcher trains the time-late variant, **Then** the same
   artefacts are produced for it.
3. **Given** a manifest, **When** training is re-run from it on the same dataset, **Then** the saved
   weights are identical.
4. **Given** no passing G0 verdict in `experiments/`, **When** the researcher starts training,
   **Then** training refuses to start and says why (constitution V).

---

### User Story 2 - Score models beside the baselines and judge G1 (Priority: P1)

The researcher turns each trained model's outputs on the test split into predictions in the same
format as the naive and classical baselines, evaluates all four together, and gets a G1 verdict.

**Why this priority**: G1 is a stop/continue decision for the project; it needs the model numbers
next to the baselines on the same test set.

**Independent Test**: evaluate a deliberately untrained model and confirm G1 fails; evaluate a model
whose predictions are truth and confirm G1 passes.

**Acceptance Scenarios**:

1. **Given** a trained model and the test split, **When** predictions are produced, **Then** they use
   the same prediction format and per-timestep rows as the baselines, so the existing evaluation
   scores them unchanged.
2. **Given** model, naive and classical predictions, **When** evaluation runs, **Then** metrics are
   reported overall and by slice, with curves against time since the zig, for every estimator.
3. **Given** the evaluation, **When** G1 is judged, **Then** it passes only if, for **both** variants,
   the model's median range error at 5 minutes after the zig is below 50% of the naive baseline's
   on the same scenarios.
4. **Given** a G1 verdict, **When** the researcher inspects `experiments/<id>/`, **Then** it contains
   the model manifests, metrics, curves and verdict, with naive and classical numbers present.

---

### User Story 3 - Controls and consistency checks (Priority: P2)

Each variant has a non-recurrent control with the same inputs and outputs (a causal 1-D CNN for the
instantaneous variant; an MLP over the flattened window for the time-late one). The report states
whether each recurrent model beats its control and whether the time-late model scores at least as
well as the instantaneous one at every point on the error-vs-time curve.

**Why this priority**: a pass on G1 is not believable if a model that ignores sequence does as well,
or if the better-informed model does worse (SRD §4: "the pipeline is suspect").

**Independent Test**: construct predictions where time-late is worse than instantaneous at one curve
point and confirm the check flags it.

**Acceptance Scenarios**:

1. **Given** trained controls, **When** evaluation runs, **Then** each control is scored with the same
   metrics and slices as its recurrent counterpart.
2. **Given** all four models, **When** consistency is checked, **Then** the report lists every curve
   point where time-late is worse than instantaneous (beyond a stated tolerance) and every metric
   where a recurrent model fails to beat its control.
3. **Given** a consistency failure, **When** the verdict is written, **Then** it is recorded as a
   failed check with detail, so the team sees it before deciding G1.

---

### User Story 4 - Rule out learning the generator's priors (Priority: P2)

The researcher retrains one variant on shuffled labels (targets permuted across scenarios) and
confirms it scores no better than the naive baseline, showing the models are not exploiting leakage
or input-label shortcuts (SRD §8 risks).

**Why this priority**: the highest-likelihood risk in the SRD is a model that learns "range is
usually ~8 km"; G1 is relative to naive for this reason, and the shuffle test makes it explicit.

**Independent Test**: run the shuffled-label training on a small dataset and compare against naive.

**Acceptance Scenarios**:

1. **Given** shuffled labels, **When** a model is trained and evaluated, **Then** its median range
   error at the gate point is within 10% (relative) of the naive baseline's.
2. **Given** a shuffled-label model that clearly beats naive, **When** the verdict is written,
   **Then** a leakage check fails and the report says so.

---

### User Story 5 - Report the result publicly (Priority: P3)

The reviewer opens the iteration-1 blog post and an interactive results review: error-vs-time curves
and sliced metrics for every model and baseline. A PR that produces results gets a preview of the
review app.

**Why this priority**: required by SRD §7/§9, but the G1 decision can be taken from the experiment
folder alone.

**Independent Test**: build the results review from a committed experiment folder and open it in a
browser; open a PR and confirm a preview link appears.

**Acceptance Scenarios**:

1. **Given** an experiment folder, **When** the results review is built, **Then** it shows curves of
   median range, course and speed error against time since the zig for all estimators, and the sliced
   metrics table.
2. **Given** a PR that changes results or the review app, **When** CI runs, **Then** a preview is
   published under `/pr/<N>/` and linked from the PR, and it is removed when the PR closes.
3. **Given** G1 is decided, **When** the site builds, **Then** the welcome page shows the G1 verdict
   and the blog post records the team's decision.

### Edge Cases

- A model produces NaN or infinite outputs for some scenario: those rows are counted as gross errors,
  never dropped.
- Training diverges (loss becomes NaN): the run stops and is reported as failed, with the manifest
  saved for diagnosis.
- Scenarios whose window ends before the 5-minute gate point: excluded from the gate figure and
  counted, as in iteration 0.
- Predicted course vector of near-zero length: course reported but flagged; it still counts in
  course error.
- Time budget exceeded on the reference machine: report the actual time; reduce dataset size only
  with a recorded justification.

## Requirements *(mandatory)*

### Functional Requirements

**Data**

- **FR-001**: The system MUST generate the iteration-1 dataset: 10^5 scenarios, σ = 0.5°, no dropouts,
  default geometry ranges, with train/validation/test/held-out splits as in iteration 0.
- **FR-002**: Training MUST read the iteration-0 feature layout and normalisation constants without
  change, loading data in batches so a 10^5-scenario train split does not need to fit in memory at
  once.

**Models**

- **FR-003**: The system MUST provide four models over the shared input/output layout: instantaneous
  (single-layer LSTM, 64–128 units, causal), time-late (bidirectional LSTM, 64–128 units per
  direction), causal 1-D CNN control, and MLP control over the flattened window.
- **FR-004**: Models MUST use only layers with direct Keras equivalents (LSTM, Bidirectional, Conv1D,
  Dense, Masking or equivalent masking), and hyperparameters MUST live in the manifest, not in code.
- **FR-005**: The loss MUST be a weighted sum of log-range, course-vector and speed MSE, masked to
  window rows, and for causal models additionally to rows after the zig.
- **FR-006**: Causal models MUST NOT use any input after timestep t when producing the output at t;
  this MUST be tested by perturbing later inputs.
- **FR-007**: Training MUST be deterministic from the manifest's seed on the pinned runtime, and MUST
  refuse to start unless a passing G0 verdict exists.
- **FR-008**: Each run MUST save the model and a manifest (hyperparameters, seeds, dataset digests,
  normalisation constants, schema and generator versions, training curve, wall time).
- **FR-009**: Hyperparameter search MUST be capped at a handful of runs per variant (default ≤ 4), and
  every run MUST be recorded, not only the best.

**Predictions and evaluation**

- **FR-010**: Model outputs MUST be converted to the shared prediction format (range from log-range,
  course from the sin/cos vector, speed unscaled, position from range and the observed bearing).
- **FR-011**: Evaluation MUST score models, naive and classical on the same test split with the
  iteration-0 metrics, slices, gate point and curves.
- **FR-012**: The system MUST judge G1: pass only if both variants' median range error at zig + 300 s
  is below 50% of naive's on the same scenarios.
- **FR-013**: The verdict MUST also record the consistency checks (time-late ≤ instantaneous at every
  curve point within tolerance; each recurrent model vs its control) and the shuffled-label leakage
  check, each with detail.
- **FR-014**: The held-out geometry split MUST be scored and reported, but MUST NOT affect G1.

**Reporting**

- **FR-015**: Each G1 run MUST write `experiments/<id>/` with all model manifests, metrics, curves,
  verdict and seeds.
- **FR-016**: The site MUST gain a blog post for iteration 1, a results-review page or app built from
  the experiment folder, glossary entries for new terms, and algorithm notes for each model.
- **FR-017**: PRs that change results or the review app MUST get a preview under `/pr/<N>/` on the
  project site, linked from the PR and removed on close.

### Key Entities

- **Model manifest**: hyperparameters, seeds, dataset and feature digests, normalisation constants,
  versions, training curve, wall time, saved-model location.
- **Training run**: one attempt for one model configuration; every run is kept.
- **Model prediction**: the same Prediction record as the baselines, with the model name as estimator.
- **Consistency check / leakage check**: named pass/fail results with detail, part of the G1 verdict.
- **G1 verdict**: gate result plus all checks; final decision recorded by the team.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each of the four models trains on the full 10^5-scenario train split within 6 hours of
  wall-clock time on the reference machine (relaxed from SRD §4's one hour by decision of
  2026-10-11; actual times reported).
- **SC-002**: Re-running any training run from its manifest reproduces identical saved weights.
- **SC-003**: A G1 verdict exists in `experiments/` with model, naive and classical numbers on the
  same test scenarios.
- **SC-004**: The shuffled-label model's median range error at the gate point is within 10% of naive's.
- **SC-005**: Every reported curve point and metric has its naive and classical counterpart beside it.
- **SC-006**: A reviewer can open the results review for any results PR without cloning the repo.

## Assumptions

- G1 is judged at the 5-minute post-zig point for both variants, using per-timestep predictions; the
  time-late variant's whole-window position error is reported but not gated.
- "Clean" means σ = 0.5° and no dropouts (SRD §7), not noise-free.
- The reference machine for SC-001 is the cloud container used for iteration 0 (4 CPU cores, no GPU).
  Decision 2026-10-11: relax SRD §4's one-hour budget to 4 hours per model (raised to 6 hours later the same day) rather than shrink the
  dataset or port to PyTorch; this conflicts with the SRD text and is flagged for an SRD amendment.
- The consistency tolerance (time-late vs instantaneous) is set in planning; default 5% relative on
  median range error per curve point, to absorb training noise.
- Training starts only after G0's machine verdict passes; the team's sign-off on G0 is expected
  before G1 results are presented.
- Derived features (bearing rate, intercepts) remain out of scope until iteration 2 (SRD §4).
- Feasibility spike (2026-10-11, `@tensorflow/tfjs-node` 4.22, 4 CPU cores, batch 256, 240 rows):
  LSTM-64 ≈ 200 windows/s (≈ 7 min per 80k-window epoch), BiLSTM-64 ≈ 100 windows/s (≈ 13 min).
  The one-hour budget therefore allows roughly 8 and 4 epochs respectively; planning must decide
  how to fit (fewer epochs, early stopping, smaller train subset) and report it.
