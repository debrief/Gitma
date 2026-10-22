# SRD Annex A: Engagement viewer and phase 2

Oct 17, 2026 · @Ian Mayo · annex to [SRD.md](SRD.md)

## A.0 Status, scope and the budget

The main body's experiment plan (§7) ended at G2 after iteration 2c: "one more iteration allowed,
then stop". That stop was an effort-budget rule written for sub-contracted work. The budget is
lifted (user decision 21, 2026-10-17): the work is now done by the project owner and the only
limit is the owner's patience. The gates themselves (§5) are unchanged; what changes is that
failing G2 no longer ends the project, and the hyperparameter cap of §7 is replaced by the
pre-registration rule in B.3.

This annex adds two things, in this order:

1. **Part A, an interactive engagement and model viewer**, built and verified first. It serves
   two needs with one tool: checking that generated engagements look realistic, and inspecting
   what the trained models do on a single engagement, in either TMA mode.
2. **Part B, the candidate changes to data, features, models and training** for a further attempt
   at G2 (and G3), chosen only after the viewer has been used on the current data and models.

Nothing in this annex is implemented until a spec under `specs/` is written against it and
approved. Where this annex and the main body disagree, the amendments listed in B.4 apply once
accepted; until then the main body stands.

**Terms.** The SRD's *ownship* is the searcher and its *target* is the subject; this annex keeps
the SRD's words.

## A.1 Purpose of the viewer

- **Realism check.** A human looks at engagements and judges whether the geometry, the turn, the
  bearings and the parameter draws look like a plausible bearings-only encounter. This is a
  judgement the agent review panel cannot make for the owner; A.5 lists what is checked and A.7
  records the outcome.
- **Model inspection.** For one engagement, show what the instantaneous and time-late models
  estimate, beside the truth and the classical solver, so that the aggregate numbers in the gate
  records can be seen as behaviour: where an estimate converges, where it sits on the prior, how
  it moves as bearings arrive.
- **Linkable evidence.** A view is addressable by URL, so a blog post, a review or a decision
  record can point at the exact engagement, model and instant it discusses.

## A.2 Functional requirements

Numbered V-nnn so a spec can trace them.

**Scenario selection**

- **V-001** A scenario is chosen by dataset (the plan that names its seed and ranges) and index,
  or by typing parameter values. It is regenerated in the browser with the same `@tma/sim`
  functions the pipeline uses, deterministically from its seed, so no scenario files are shipped.
  A golden test shows the browser bundle regenerates a fixed scenario byte-identically with the
  Node generator.
- **V-002** Next, previous and random scenario; a typed index; a list of bookmarked indices
  (for example the worst cases named in a review).

**Plan view**

- **V-003** A 2-D plan, x east and y north in metres, north up, equal aspect, pan and zoom, with a
  square grid whose spacing is chosen from the zoom (100 m to 10 km) and labelled, so scale is
  always readable.
- **V-004** Ownship's track with leg 1, the turn (shaded, with its rate) and leg 2 distinguished;
  the target's truth track; markers at window start, zig (the first sample after the turn, as the
  gates count it) and the current cursor time; both platforms' current positions with heading
  arrows.
- **V-005** Observed bearings drawn as rays from ownship's position at each sample (dropouts
  omitted and listed), with an option to show the true bearing beside the noisy one.

**Time-series plots**, time on a shared axis with the cursor linked to the plan

- **V-006** Course (degrees true) and speed (knots) against time for both platforms, truth; the
  turn shaded.
- **V-007** Bearing against time: observed and true; bearing rate.
- **V-008** In model modes (V-011, V-012): estimate and truth for range, course and speed against
  time, with the error curves of §5 for this one scenario; the gate points (zig + 5 min and
  zig + 10 min) marked.

**Metadata**

- **V-009** The scenario's parameter draws (window, ownship speed, zig angle and turn rate, initial
  range and bearing, target course and speed, noise σ, dropout fraction), its derived keys (mean
  and minimum range, zig index, samples), its seed and index, and the generator and schema
  versions and commit.

**Modes**, a single toggle

- **V-010** *Truth only*: V-003 to V-009 without estimates.
- **V-011** *Instantaneous*: a "now" cursor at time t. The model receives the bearings from window
  start to t, as the SRD defines the variant (§2), and its estimate at t is shown on the plan (the
  estimated target position on the current bearing, the estimated velocity vector, the range
  ring) and as numbers beside the truth and the error: range, bearing at t (observed and true),
  course, speed, and ownship's position. The cursor may be placed before the zig, in which case
  the estimate is shown but labelled unobservable. The estimate trail (the estimate at every
  earlier cursor time) is drawn as a track.
- **V-012** *Time-late*: the model receives the full window and its estimated target position at
  every timestep is drawn as a track over the truth, with V-008's plots and this scenario's
  summary metrics (median range, course and speed error; position error over the window).
- **V-013** *Classical overlay*, available in both model modes: the least-squares solver's
  per-timestep estimates on the same scenario as a third track, with its convergence flags; the
  naive baseline's numbers in the panel. Every model figure is shown beside both, as §5 requires
  of any reported result.
- **V-014** *Bearing-window trimming* (deferred, D2): a second slider setting the first bearing
  passed to the model, so the effect of withholding early bearings can be seen. The models were
  trained on windows that start at window start, with the frame and the time channel anchored
  there (§2, §4); a trimmed window is outside their training distribution and the viewer would
  say so. Not in the first viewer.

**Models**

- **V-015** Any committed model folder under `experiments/<id>/models` (tfjs layers format) can be
  selected; its manifest (id, config, source dataset header, the gate experiment it was scored in)
  is shown. The viewer offers every gate's carried pair by default (D3): iteration 1
  (`experiments/20261012-g1-r2/models`), iteration 2 (`20261014-i2-g2/models`), 2b
  (`20261015-i2c-val/models`) and 2c (`20261016-i2d-val/models`); the controls stay selectable
  by path. The latest gate's pair is selected on load.
- **V-016** Inference runs in the browser with `@tensorflow/tfjs` on the same `@tma/features`
  functions and normalisation constants the pipeline uses. A test shows the browser prediction
  for a fixed scenario agrees with `tma-model-predict` to float32 tolerance. Budget: under two
  seconds for one scenario with the 2c BiLSTM on a laptop; model weights under 3 MB each.

**Provenance, sharing, export**

- **V-017** The URL encodes the view (dataset, index, mode, cursor, model, trimming), so a view can
  be linked from a post, a review or a decision record and reopened unchanged.
- **V-018** Export of the plan and plots as PNG, and of the scenario and the estimate rows as
  NDJSON in the schema's `Scenario` and `Prediction` types, so a viewed case can be fed back into
  the CLI pipeline.

## A.3 Non-functional requirements

- **Reuse, not reimplementation.** The viewer bundles `@tma/sim`, `@tma/features` and
  `@tma/classical` as they are. The portability rules of §6 (plain functions over numeric arrays)
  are what make this possible, and the viewer must not add browser-only forks of them.
- **Static.** A page of the Docusaurus site (the `packages/demos/` slot of §6, the first demo
  built), deployed with the site and in PR previews; no server, no network call after load.
- **Size.** No generated data is committed for the viewer; scenarios are regenerated. Model
  weights are read from the committed experiment folders.
- **Determinism.** The same URL shows the same view on any machine; the seeded PRNG rule of §3
  applies to the browser bundle.
- **Types.** Anything the viewer stores or exports uses the LinkML types; the URL state and any
  viewer-specific record are added to `schema/` if they are persisted.

## A.4 Acceptance of the viewer

- A PR with a site preview, reviewed as any other PR (§9), with the golden test of V-001 and the
  agreement test of V-016 in CI.
- A short blog post with linked views (V-017) of, at least: one typical engagement, the
  engagement with the largest 2c speed error at zig + 10 min on the seed-203 split, and one
  held-out 20–30 km engagement.
- The realism check of A.5 performed by the owner and its outcome recorded (A.7).

## A.5 Realism checklist

What the owner checks in the viewer, on a sample of engagements from each dataset in use, before
Part B starts. The list is a starting point; the owner adds to it.

- Ownship's turn is flown at the recorded rate; course and speed are constant on each leg; the
  zig falls at 40–60% of the window.
- Target speed and course are constant; no platform teleports; positions, courses and speeds are
  within the parameter ranges of the plan.
- Bearings point at the target; noise looks like the recorded σ; dropouts are where the valid
  flags say.
- Bearing rate behaves as geometry says (fastest at short range and high crossing speed).
- Initial ranges span the log-uniform range (short ranges are present, not rare).
- The classical solver converges on the cases the viewer shows as easy and flags the ones it
  cannot solve; the gross-error cases in the gate records look like unobservable geometries, not
  generator defects.
- Anything that looks wrong is recorded with the URL of the view.

## A.6 Out of scope for the viewer

Editing scenarios in place, training in the browser, multi-target display, real data. A
training-progress demo (§9, PR preview apps) remains a separate item.

## A.7 Record of the realism check

**2026-10-17, the owner, in the viewer's PR preview (PR #51).** The owner looked at engagements
in the viewer; the record does not list the indices viewed.

**Findings.**

- **Platform motion looks right.** Tracks, turns and bearings are realistic.
- **The zig comes too late.** With both platforms on steady legs there is not enough information
  for TMA, unless there is other context such as a predicted initial detection range or a speed
  estimate from acoustic cues.
- **Operational practice.** An operator with no steady solution zigs again, and turning towards
  the contact traditionally gives a better solution.

**What the gate data says.** Spec 007 research R1 tested these ideas against the seed-203 test
predictions.

- **Shorter first legs are worse at a fixed time after the zig.** The gates and the training loss
  already exclude the pre-zig period.
- **Turning towards the contact helps only when the turn crosses the line of sight.**
- **Larger turns help every estimator.**

**Decision (decision 22, D4).** Part B starts after a generator change: lever B.2.1. There is a
second zig, both turns cross the line of sight, and the first zig keeps its timing. This is
iteration 3, spec 007, judged on fresh seed 204. The new engagements are shown in the viewer
before training.

## B. Phase 2: a further attempt at G2

### B.1 What three G2 attempts established

The gate records (`experiments/20261014-i2-g2`, `20261015-i2c-g2`, `20261016-i2d-g2`) and their
panel reviews say:

- Range and course pass with wide margins; speed fails at 1.47 / 1.53 kt against 1 kt, where the
  classical solver reaches 0.61 kt, at the Cramér–Rao bound.
- The models' speed error does not follow the geometry: it is flat at 1.2–2.0 kt across range and
  bearing-rate bands where classical's falls to 0.1–0.4 kt; the models carry a population prior
  refined by about two knots of scatter, and the scatter, not the shrinkage, is the floor.
- Each lever tried (training budget, speed weight in the loss, capacity) moved speed by about
  0.3 kt as a uniform shift; neither approaches the threshold, and capacity was shown flat in a
  scan.
- Early in the track the time-late model is more robust than classical to non-convergence; given
  ten minutes classical leads everywhere.
- One training seed per model throughout; seed-to-seed variance is unmeasured.

### B.2 Candidate levers

Each is a separate, pre-registered experiment (B.3). None is chosen until A.7 is recorded.

1. **Observability in the data** (the owner's lead). Larger or more ownship course changes: zig
   angles beyond 90°, two zigs (three legs), an earlier first zig, an ownship speed change at the
   zig, or longer windows. A change to the generator is a change to the problem: it is declared as
   such, the §3 parameter table gets new rows, G0 is re-run on the new generator, naive and
   classical are re-baselined on the new data and reported beside every model figure (the gate
   thresholds are absolute, so classical's improvement is reported, not subtracted), and the new
   dataset takes a new seed from the reserved list. The viewer shows the new engagements before
   any training.
2. **Output parameterisation for speed.** The speed target is scaled by ownship's maximum
   (15 kt), so target speeds above it fall outside the normalised range, where the models shrink
   most; this lead was named by two panels and never tried. Options: scale by the target speed
   range, predict log speed, predict velocity components (vx, vy) and derive course and speed, or
   a separate speed head with its own loss scale.
3. **Derived features.** The `derived` feature set (bearing rate, its validity flag, the
   bearing-line intercept) was built in iteration 2 and never trained on. A per-leg steady-track
   fit (spec 003 research R18) as an input channel or an auxiliary target would give the network
   the second-order quantity the panels say it does not extract.
4. **Training.** At least two seeds per model, so the record can separate a lever's effect from
   initialisation; a learning-rate schedule; longer patience. The §4 wall-clock cap is already
   exceeded by chained CI jobs (27.5 h for the 2c BiLSTM) and is amended in B.4.
5. **Capacity.** Only with a scan showing the lever is not flat at the new settings.
6. **Hybrid.** The model initialises the classical solver, or the solver refines the model's
   estimate; this addresses non-convergence and speed together and is the natural G3 question. It
   is a different claim from "a network alone", and is reported as such.

### B.3 Sequence and rules

1. Part A is built, verified and signed off (A.4, A.7).
2. One lever per iteration, as a spec with a decision record committed before training: the
   change, the forecast, the carried-set rule, the fresh test seed. The hyperparameter cap of §7 is
   replaced by this pre-registration: any number of configurations may be trained, but what is
   scored on a test split is declared before it is trained.
3. A validation diagnostic is read before any test scoring; a lever that does not move speed on
   validation by more than the interval half-width is not taken to a test split.
4. Each gate decision uses a fresh test seed (204 onward), reserved afterwards, and the agent
   review panel of §8.
5. The project continues while the owner chooses to continue; an iteration's write-up states
   what moved, what did not, and what the next lever is. A G2 pass sends the plan to G3 as §7
   already says.

### B.4 Amendments to the main body (apply when this annex is accepted)

- **§7, iteration 2 row:** replace "then stop" with "then Annex A, Part B: further iterations at
  the owner's discretion, one pre-registered lever each, judged on fresh seeds". The
  hyperparameter cap sentence under "Working pattern" is replaced by B.3's pre-registration rule.
- **§4, TensorFlow.js constraints:** replace the 6-hour wall-clock cap with "training runs as
  chained jobs on CI with checkpoints after every epoch (AGENTS.md); there is no cap beyond the
  runner's limits, and every job's duration is recorded".
- **§3, parameter table:** rows for any generator change chosen under B.2.1, with the iteration
  they apply from.
- **§6, repository layout:** `packages/demos/` holds the viewer (A), the first demo built.
- **§8, decisions taken:** add decision 21 (budget lifted, 2026-10-17) and the A.7 record when made.

### B.5 Decisions the owner takes before the viewer spec is written

- **D1** Inference location: in the browser (V-016, the default here) or precomputed estimate
  files committed per experiment. _Decided 2026-10-17: in the browser._
- **D2** Whether V-014 (bearing-window trimming) is in the first viewer or deferred. _Decided
  2026-10-17: deferred; the first viewer has the "now" cursor only._
- **D3** Which model folders ship by default (the 2c pair, or every gate's carried pair).
  _Decided 2026-10-17: every gate's carried pair (iterations 1, 2, 2b and 2c), so one engagement
  can be stepped through the project's history; controls remain selectable by path._
- **D4** After A.7: the first lever of B.2. _Decided 2026-10-17: B.2.1, a second zig with both
  turns across the line of sight (spec 007)._
- **D5** After iteration 3 stopped at validation: the next lever. _Decided 2026-10-22: B.2.2 as
  velocity outputs, combined with B.2.3 (derived features), on iteration 3's problem, seed 205
  (spec 008, decision 23)._
