# Feature Specification: Iteration 2 — Is the Solution Useful Under Noise? (Gate G2)

**Feature Branch**: `003-iteration-2-noise`

**Created**: 2026-10-11

**Status**: Draft — **blocked on G1**. Iteration 2 starts only if the G1 verdict (being judged by
the agent review panel now) is `pass`. Items whose content depends on the G1 outcome are marked
**[G1-dependent]**; the one decision needing user confirmation before planning is final is marked
**[USER]**.

**Input**: User description: "Iteration 2 of the SRD: the same models on σ = 1–2° and up to 10%
dropouts, one round of feature/architecture changes, and judge G2. Also land the deferred G0-panel
provenance item (dataset header records generator commit/dirty; training checks lineage against
the G0 commit)."

**SRD trace**: §3 (scenario parameters: σ, dropouts, rate-limited ownship turn "after iteration 1";
dataset versioning), §4 (shared input, derived features "reserved for iteration 2 if raw features
stall", TF.js budget, controls), §5 (metrics incl. time-late window position error, slices, G2), §7
(iteration 2 row, experiment outputs, hyperparameter cap), §8 (risks: prior-learning, leakage;
decision: agent review panel), §9 (blog, results review, PR previews). Builds on spec 001 (pipeline,
G0) and spec 002 (models, G1). Deferred items from `experiments/20261011-g0-r3/review.md`: dataset
header provenance, bootstrap confidence intervals, classical comparison on rows both estimators
answer, window-mean position error.

**Out of scope** (user decision 2026-10-11: SRD kept as is): target manoeuvres, multi-target,
clutter, sensor artefacts beyond Gaussian bearing noise and dropouts, EKF, 10^6-scenario datasets
(iteration 3), PyTorch port.

**Backlog for a later iteration** (user decision 2026-10-12):

- **Ownship autopilot wiggle:** small heading oscillations that marine autopilots introduce to save
  rudder. Generator work: an ownship motion model, like the rate-limited turn here.
- **Wiggle-robust ownship leg feature:** straight or turning. Once ownship course carries wiggle,
  telling a real leg change from it is a genuine detection problem. Options: a smoothed
  course-rate filter (a derived feature) or a small learned detector. A learned detector is a
  separate CLI stage, and its training-split outputs must come from data it was not fitted on
  (no stacking leakage).
- **Target leg / manoeuvre detector:** only with target manoeuvres, which are out of scope above.

## User Scenarios & Testing *(mandatory)*

Actors: the **researcher** (generates data, trains, runs the gate), the **agent review panel** (five
specialist AI reviewers, constitution 1.2.0 Governance, takes the G0 re-run and G2 verdicts), the
**reader** (follows the site and PR previews).

### User Story 1 - Trustworthy data lineage (Priority: P1)

Every dataset file says which generator commit produced it and whether that tree was clean, and
training refuses data that cannot be traced to the code verified by the latest G0 pass.

**Why this priority**: deferred from the G0 panel (round 3, red team). Iteration 2 regenerates all
data, so it is the cheapest point to close the gap; every later result depends on it.

**Independent Test**: generate a small dataset from a clean tree and from a dirty tree; build
features from each; confirm training accepts the first and refuses the second with a reason;
confirm it also refuses data whose recorded commit has generator code differing from the G0
commit.

**Acceptance Scenarios**:

1. **Given** a clean working tree, **When** a dataset is generated, **Then** its header records the
   generator commit and `dirty = false`, and the feature files built from it carry that header.
2. **Given** a dirty tree, **When** generation runs without an explicit override, **Then** it refuses;
   with the override it writes `dirty = true`.
3. **Given** features whose source header is dirty, lacks provenance, or names a commit whose
   generator code differs from the latest passing G0's commit, **When** training starts, **Then** it
   refuses (exit 2) and names the failing condition.

---

### User Story 2 - Train the iteration-1 models on noisy data (Priority: P1)

The researcher trains the same four models plus the shuffled-label run, with the iteration-1
architectures and feature layout, on a 10^5-scenario dataset with σ ∈ {1°, 2°} and per-scenario
dropout fractions up to 10%, on GitHub-hosted runners within the per-job limit.

**Why this priority**: SRD §7's first build item for iteration 2 ("same models on σ = 1–2°, 10%
dropouts"); it measures what noise does to the iteration-1 solution before anything is changed.

**Independent Test**: run the training workflow on the CI-sized configs (300 scenarios, 1 epoch) and
confirm five model artefacts and manifests are produced with noisy-data dataset digests.

**Acceptance Scenarios**:

1. **Given** the iteration-2 dataset, **When** phase A training runs, **Then** each model's manifest
   records the iteration-2 dataset digest, the carried-forward configuration and a stop reason other
   than `diverged`, with wall time ≤ 19,800 s.
2. **Given** phase A models, **When** they are scored on the **validation** split, **Then** the G2
   criteria and all iteration-1 checks are reported per variant, without touching the test split.
3. **Given** a carried-forward configuration **[G1-dependent]**, **When** the configs are written,
   **Then** each variant uses the G1-selected configuration (units, learning rate) unchanged, and
   any deviation is recorded with a reason.

---

### User Story 3 - One round of feature/architecture change (Priority: P1)

If phase A stalls (fails any G2 threshold on validation, or is inconclusive), the researcher makes
exactly one pre-declared change — by default the derived features reserved in SRD §4 (a causal
bearing-rate estimate and the bearing-line intercept) — retrains all five runs with it (phase B),
and chooses the carried model set on validation evidence before the test split is scored.

**Why this priority**: SRD §7 grants iteration 2 one round of changes and SRD §5 makes G2's failure
path "iterate features/architecture once"; the round must be honest (pre-declared, every run kept).

**Independent Test**: build features with the derived set on a small dataset; confirm the new
channels are causal (perturbing rows after t leaves channels ≤ t unchanged), computed from inputs
only, and zero on dropout rows; train a tiny config with 13 input channels.

**Acceptance Scenarios**:

1. **Given** phase A validation results, **When** the change is chosen, **Then** a decision record
   (what changes, why, evidence) is committed before phase B training starts.
2. **Given** the derived feature set, **When** features are built, **Then** the feature file header
   names the feature set and channel list, and a model trained on one set refuses files of another.
3. **Given** phase A and B on validation, **When** the carried set is chosen, **Then** the choice
   and its rule are recorded before the test split is scored; both sets are reported on test.
4. **Given** phase A passes on validation with confidence intervals clear of the thresholds,
   **Then** phase B is skipped and the skip is recorded **[USER]** (see Assumptions).

---

### User Story 4 - Judge G2 beside the baselines, with uncertainty (Priority: P1)

The researcher evaluates the carried models, naive and classical on the test split and gets a G2
verdict: thresholds on the σ = 1° slice at zig + 300 s, bootstrap confidence intervals, the
iteration-1 consistency/control/leakage checks repeated on noisy data, and a classical comparison
on rows both estimators answer.

**Why this priority**: G2 is the last stop gate in the SRD.

**Independent Test**: synthetic metrics where a model's median range error is 0.15 with a CI of
[0.13, 0.17] → pass; 0.19 with CI [0.17, 0.22] → inconclusive; 0.25 → fail; same for course and
speed; a sample mismatch between model and naive → fail.

**Acceptance Scenarios**:

1. **Given** predictions for every estimator, **When** G2 is judged, **Then** each gated variant
   passes only if, on the σ = 1° slice at zig + 300 s, median range error < 20%, median course
   error < 10° and median speed error < 1 kt, each with its 95% CI upper bound below the threshold.
2. **Given** a CI that straddles a threshold, **When** the verdict is written, **Then** that check is
   `inconclusive` and the gate cannot be `pass`.
3. **Given** the evaluation, **When** results are reported, **Then** every metric is shown overall
   and by range band, zig band, σ and dropout band, beside naive and classical, with n per slice.
4. **Given** model and classical predictions, **When** compared, **Then** the comparison uses only
   rows both answered and reports each estimator's coverage separately.
5. **Given** the time-late models, **When** metrics are reported, **Then** the SRD §5 window-mean
   position error is reported (median and P90 over scenarios), not gated.

---

### User Story 5 - Panel decision and public report (Priority: P2)

The agent review panel reviews the G2 evidence (and, first, any G0 re-run) until no reviewer rejects
and no blocker/major finding is open; the site gains an iteration-2 results page, a blog post with
the decision, and updated algorithm, glossary and evaluation pages.

**Why this priority**: required by constitution Governance and SRD §7/§9; the gate cannot be
decided without the panel, but the machine verdict exists without the site.

**Independent Test**: build the site from a committed CI-sized experiment folder; the G2 page
renders curves and the σ/dropout slice tables; the welcome page shows the G2 status.

**Acceptance Scenarios**:

1. **Given** the G2 experiment folder, **When** the panel has converged, **Then** `review.md`
   records every round and `verdict.json`'s `decided_by` names the final round.
2. **Given** the decision, **When** the site builds, **Then** the results page, blog post and
   welcome-page status reflect it.

---

### User Story 6 - Rate-limited ownship turn (Priority: P2) **[USER]**

The generator models the ownship zig as a constant-rate turn instead of an instantaneous course
change, as SRD §3 schedules after iteration 1. Recommended for iteration 2 (research R3) because the
provenance change in US1 already forces a G0 re-run and panel; severable if the user defers it to
iteration 3.

**Why this priority**: realism the SRD already plans; it makes G2, the last stop gate, a judgement
on less idealised data. Not P1 because G2 is defined without it.

**Independent Test**: known-answer tests: a 90° turn at 1°/s from (0, 0) at 5 m/s ends at the
hand-computed arc end-point and course; t = 0 invariants unchanged; G0 noise-free recovery passes.

**Acceptance Scenarios**:

1. **Given** a turn rate drawn per scenario, **When** a scenario is generated, **Then** ownship
   follows a circular arc at constant speed between the two legs, and the metadata records turn
   start and the first sample on leg 2.
2. **Given** the new generator, **When** G0 is re-run and reviewed by the panel, **Then** it passes
   before any iteration-2 training starts.

### Edge Cases

- **Dropout at the gate row** (zig + 300 s): the row is still scored for every estimator; models
  predict from the inputs they have; naive/model position uses the last valid bearing.
- **No valid bearing before t**: the row is scored as non-converged (+∞, counts as gross) for every
  estimator that cannot produce an estimate; models still produce outputs and are scored.
- **Dropouts clustered after the zig** (independent per-sample draws can leave long gaps): no
  special handling; slice by dropout band shows the effect.
- **Bearing-rate feature with fewer than 3 valid samples in its trailing window**: rate = 0 and a
  `rate_valid` flag = 0; never interpolated from future rows.
- **Bearings near 0/2π with σ = 2°**: rate estimation unwraps relative to the latest valid bearing.
- **σ = 1° slice smaller than expected** (σ drawn uniformly from two values, ≈ 5,000 test scenarios
  minus exclusions): reported n; CI width shows the effect.
- **Classical non-convergence rises with noise** (> 10% makes its P90 +∞): classical comparison on
  common rows, coverage reported separately (review deferred item).
- **Phase A hits the wall-clock cap** rather than early stopping: reported; counts as stalled only
  through the G2 criteria, not by itself.
- **Turn not complete before window end** (if US6 is accepted): the geometry is redrawn (counted in
  `redraw_count`). Scenarios with less than 300 s on leg 2 are excluded from the gate point and
  counted, as in iterations 0–1; the excluded fraction is reported (it rises with turn duration).
- **Old (pre-0.5.0) datasets**: readable for inspection; refused by training (no provenance).

## Requirements *(mandatory)*

### Functional Requirements

**Provenance (deferred from G0 panel round 3)**

- **FR-001**: Every dataset header MUST record the generator git commit and whether the tree was
  dirty at generation; generation MUST refuse a dirty tree unless explicitly overridden.
- **FR-002**: Feature files MUST carry their source dataset header (so lineage survives the
  features stage), and the feature set and channel list they contain.
- **FR-003**: Training MUST refuse features whose source header lacks provenance, is dirty, or names
  a commit whose generator code (the G0 guard's protected paths) differs from the latest passing
  G0's commit, in addition to the existing G0 guard.
- **FR-004**: Any change to the protected generator paths MUST be followed by a G0 re-run and agent
  panel review before training; the plan MUST NOT merge such a change while a G1 re-run may still
  be required.

**Data**

- **FR-005**: The system MUST generate the iteration-2 dataset: 10^5 scenarios, σ drawn uniformly
  from {1°, 2°}, dropout fraction drawn per scenario uniformly in [0, 0.10], other ranges as
  iteration 1, splits 80/10/10 plus held-out geometry (20–30 km) with the same noise and dropouts,
  from a new dataset seed.
- **FR-006** **[USER]**: If US6 is accepted, the generator MUST model the zig as a constant-rate turn
  at constant speed, with the turn rate drawn per scenario and recorded; `zig_index` MUST keep its
  meaning "first sample on leg 2" (after the turn completes) so downstream masking, gate points and
  curves are unchanged; the generator version MUST be bumped.

**Models and the change round**

- **FR-007**: Phase A MUST train the four iteration-1 architectures and the shuffled-label run with
  the G1-carried configurations **[G1-dependent]** and the unchanged iteration-1 feature layout.
- **FR-008**: The round of change MUST be a single pre-declared change applied to all five runs,
  committed as a decision record before phase B training; default candidate: derived features
  (causal trailing least-squares bearing rate with validity flag, and bearing-line intercept
  `x_o cos b − y_o sin b`), computed from inputs only.
- **FR-009**: Derived features MUST be causal (verified by perturbation), zero on dropout and padding
  rows, normalised with constants computed from training inputs only, and portable (plain functions
  over numeric arrays).
- **FR-010**: Hyperparameter search MUST stay within SRD §7's cap: at most 2 configurations per
  model per phase, all runs recorded.
- **FR-011**: Training MUST run on GitHub-hosted runners, one job per model, each ≤ 5.5 h of training
  (`max_wall_s` 19,800 with the predictive epoch stop), deterministic from its manifest.

**Evaluation and gate**

- **FR-012**: Model choice between phases (and phase B's go/no-go) MUST use the validation split
  only; the test split MUST be scored once per carried set, with both phases reported if B ran.
- **FR-013**: Evaluation MUST add a dropout-band slice (0–5%, 5–10%) to the existing range, zig and σ
  slices, report n per slice and draw no conclusions from slices with n < 200.
- **FR-014**: The system MUST judge G2: for each gated variant **[USER: both variants, as G1]**, on
  the σ = 1° slice at zig + 300 s, median range error < 0.20, median course error < 10°, median speed
  error < 1 kt, scored on the same scenarios as naive and classical.
- **FR-015**: Each gated median MUST carry a seeded, scenario-resampling bootstrap 95% CI; a check
  whose CI straddles its threshold MUST be `inconclusive`. The machine verdict combines checks as
  G1 did (research R8): any threshold, ratio or shuffled-label failure ⇒ `fail`; otherwise any
  inconclusive one, or a `time-late-not-worse` failure ⇒ `inconclusive`; control checks are reported
  only. A consistency-only `inconclusive` is decided by the panel as a pass with the caveat stated
  (plan decision 12, user 2026-10-13).
- **FR-016**: The G2 verdict MUST repeat the iteration-1 checks on noisy data (each variant < 0.5 ×
  naive; time-late not worse than instantaneous; recurrent beats control; shuffled labels at naive)
  as named checks.
- **FR-017**: Model-versus-classical comparison MUST be computed on rows both estimators answered,
  with each estimator's coverage reported separately; it is reported, not gated (G3 is iteration 3).
- **FR-018**: Time-late models MUST report SRD §5 window-mean position error per scenario,
  summarised as median and P90; reported, not gated.
- **FR-019**: The held-out geometry split MUST be scored and reported, not gated.

**Reporting and governance**

- **FR-020**: Each G2 run MUST write `experiments/<id>/` with manifests (data, models, decision
  record), metrics, curves, comparison, verdict, seeds and training logs.
- **FR-021**: The G2 verdict MUST be decided by the agent review panel, recorded in
  `experiments/<id>/review.md`; the same applies to any G0 re-run.
- **FR-022**: The site MUST gain an iteration-2 results page (σ and dropout slices selectable), a blog
  post with the decision, updated feature-layout, generator (if US6), evaluation (G2, CIs, paired
  comparison) pages and glossary entries for new terms.

### Key Entities

- **Dataset provenance**: generator commit and dirty flag in every dataset header; source header in
  every feature file.
- **Feature set**: `raw` (iteration-1 layout, 10 channels) or `derived` (13 channels); recorded in
  the feature file and the training config.
- **Change decision record**: the pre-declared phase-B change, its evidence and the carried-set
  rule.
- **Gate check with interval**: value, threshold, CI bounds, result `pass`/`fail`/`inconclusive`.
- **Paired comparison**: model vs classical on common rows, with coverage.
- **G2 verdict**: G2 checks plus repeated iteration-1 checks; decided by the panel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of iteration-2 dataset and feature files carry provenance; training refuses each
  of the four bad-lineage cases in tests.
- **SC-002**: Every training job finishes within GitHub's 6 h job limit (training ≤ 5.5 h), and
  re-running a CI-sized config reproduces identical weights.
- **SC-003**: A G2 verdict exists with every gated value, its 95% CI and threshold, beside naive and
  classical on the same scenarios, decided by the panel.
- **SC-004**: The shuffled-label run on noisy data scores within ±10% of naive at the gate point
  (with derived features too, if phase B ran).
- **SC-005**: No test-split metric is computed before the carried set and phase-B decision are
  committed (checked by commit order in the experiment record).
- **SC-006**: A reader can see the iteration-2 results, the σ = 1° gate figures with CIs and the
  decision on the site without cloning the repository.

## Assumptions

- **Precondition**: G1 passes. If G1 fails, the SRD ends the project; this spec is then closed
  unbuilt, except US1 which may still be merged as hygiene.
- **[G1-dependent]**: carried configurations per variant; whether bootstrap CIs (spec 002 T033) were
  implemented for G1 (reuse) or not (built here); whether G1 panel findings require changes to
  checks or tolerances; whether iteration-1 models hit the wall-clock cap (if so, iteration-2 runs
  inherit an undertraining risk); the merged form of `.github/workflows/train.yml`.
- "σ = 1–2°" (SRD §7) means σ ∈ {1°, 2°} from SRD §3's value set; 0.5° is not trained on.
- "10% dropouts" (SRD §7) is read with SRD §3 ("0–10% of samples missing at random") as a per-scenario
  fraction uniform in [0, 10%]; the 5–10% dropout slice shows the high end.
- G2 is judged at zig + 300 s on the σ = 1° slice of the test split (all dropout fractions), for both
  variants, mirroring G1. Whether one passing variant suffices is a user decision **[USER]**.
- Phase B runs only if phase A stalls on validation (SRD §4: derived features are for when "raw
  features stall"). Running it anyway for information is a user decision **[USER]**.
- G2's failure path (SRD §5/§7: one more iteration, then stop) is a separate iteration ("2b") with its
  own spec; phase B inside this iteration is the "one round of changes" of SRD §7.
- The rate-limited turn (US6) is recommended for iteration 2 but needs user confirmation **[USER]**;
  if deferred, US6 and FR-006 are removed and a G0 re-run is still required by US1.
- The classical solver is unchanged; it uses stored ownship positions, so a rate-limited turn needs
  no solver change.
