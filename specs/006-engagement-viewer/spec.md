# Feature Specification: Engagement and model viewer

**Feature Branch**: `006-engagement-viewer`

**Created**: 2026-10-17

**Status**: Planned. SRD Annex A accepted 2026-10-17 (PR #49); decisions D1–D3 taken.

**Input**: SRD Annex A, Part A. The owner wants to see engagements, to check they look realistic,
and to see what the trained models do on one engagement, in both TMA modes. One interactive
viewer serves both, with a toggle between truth, instantaneous and time-late.

**SRD trace**: Annex A §A.1–A.7 (requirements V-001 to V-018), §2 (frame, the two variants), §3
(generator), §4 (inputs, outputs), §5 (baselines beside every figure), §6 (portability,
`packages/demos/`), §9 (site, PR previews).

**Decisions** (Annex A §B.5): D1 inference runs in the browser on the committed weights; D2
bearing-window trimming (V-014) is deferred; D3 every gate's carried pair ships by default
(iterations 1, 2, 2b and 2c).

**Out of scope**: V-014; the realism check itself (A.5, the owner's); any Part B change; editing
scenarios; training in the browser.

## User stories

### US1 — See an engagement (P1)

Choose a dataset and a scenario index (or step, or pick at random, or open a bookmark) and see the
2-D plan with a scaled grid, both platforms' tracks, the turn, the bearings, and the course,
speed and bearing plots for both platforms, with the scenario's parameters and provenance.

**Acceptance**: the scenario shown is byte-identical to `generateScenario(seed, index, ranges)`
in Node for the same dataset; the grid is labelled at every zoom; the cursor moves the plan and
every plot together.

### US2 — See the instantaneous model (P1)

With a "now" cursor at time t, see the model's estimate at t (target position on the current
bearing, velocity vector, range ring; range, bearing, course and speed beside truth and the
error) and the trail of earlier estimates; estimate-vs-truth plots for range, course and speed
with the gate points marked; the classical solver's estimates and the naive numbers beside it.

**Acceptance**: the estimate at t equals the pipeline's per-timestep prediction for that row (the
causal model's row t depends only on bearings up to t, so one forward pass serves every cursor
position); before the zig the estimate is shown and labelled unobservable.

### US3 — See the time-late model (P1)

See the model's estimated target track over the whole window over the truth, with the same plots,
this scenario's summary errors, and the classical track.

### US4 — Choose the model (P2)

Choose any of the four carried pairs; see its manifest (id, config, the dataset it was trained
on, the gate it was scored in), and a note when the scenario comes from a different dataset than
the model was trained on.

### US5 — Share and export (P2)

The URL holds the view; reopening it shows the same view on any machine. Export the plan and plots
as PNG and the scenario and estimates as NDJSON in the schema's types.

## Functional requirements

- **FR-001** (V-001): Scenarios are regenerated in the browser with `@tma/sim`; no scenario files
  ship. A test bundles the viewer's core for the browser platform (no Node built-ins) and shows it
  regenerates fixed scenarios byte-identically with the Node generator.
- **FR-002** (V-002, V-017): Dataset, index, mode, cursor time, model pair and overlays live in the
  URL query; next, previous, random and bookmarks (featured bookmarks committed with the site; the
  viewer's own in browser storage).
- **FR-003** (V-003–V-005): The plan view (equal aspect, north up, pan and zoom, grid of 1–2–5 ×
  10ⁿ m labelled), legs, turn, zig marker (the first sample after the turn), cursor, headings,
  observed bearing rays (dropouts omitted), true bearings optional.
- **FR-004** (V-006–V-008): Course, speed, bearing and bearing-rate plots against time on a shared
  axis with the cursor; in model modes, range, course and speed estimate and truth, with zig + 5
  min and zig + 10 min marked.
- **FR-005** (V-009): Parameters, derived keys, seed, index, generator version.
- **FR-006** (V-010–V-013): Modes truth / instantaneous / time-late; classical overlay in both
  model modes; naive numbers beside every model figure.
- **FR-007** (V-015, V-016): Models load from the site's static copy of the committed experiment
  folders; inference with `@tensorflow/tfjs` on the CPU backend (deterministic across machines)
  through the same `@tma/features` encoding and decoding the pipeline uses. A test shows the
  browser path agrees with the Node (`tfjs-node`) path to float32 tolerance.
- **FR-008** (V-018): PNG export of the plan and plots; NDJSON export of the scenario and the
  model, classical and naive predictions, canonical JSON in the schema's types.
- **FR-009** (A.3): No browser-only forks of `sim`, `features` or `classical`: browser-safe subpath
  exports of the existing modules.

## Success criteria

- **SC-001**: Inference for one scenario with the 2c BiLSTM under two seconds on a laptop; the
  page's weights total under 5 MB.
- **SC-002**: The viewer page builds in `pnpm site:build` and in PR previews; no console errors on
  load in Chromium.
- **SC-003**: A blog post links views of a typical engagement, the 2c instantaneous model's
  largest speed error at zig + 10 min on the seed-203 split, and a held-out 20–30 km engagement.
- **SC-004**: The owner performs the realism check (A.5) and the record (A.7) is committed.
