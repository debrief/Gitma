# Engagement viewer

Source: `packages/demos/`, page `site/src/pages/viewer.jsx`. Requirements: SRD Annex A Part A,
spec 006.

The [viewer](/viewer) shows one engagement at a time: the plan, the platforms'
course and speed, the bearings, and the carried models' estimates beside the classical solver and
the naive baseline. Its first job is the owner's realism check (Annex A §A.5); its second is to
show where and why the models fail, case by case, which the gate statistics cannot.

## Scenarios

No scenario files ship. The page holds a catalogue of datasets (seed, index range and parameter
ranges, copied from the gate experiments' dataset headers) and regenerates a scenario on demand
with `generateScenario` from `@tma/sim`, the function `tma-generate` calls. A test bundles the
viewer's core for the browser and checks the regenerated scenarios are byte-identical to the
Node generator's. Generator 0.2.0 reproduces 0.1.0's instantaneous-zig scenarios byte for byte,
so the iteration-1 datasets regenerate too.

## Models

Each gate's carried pair (instantaneous LSTM and time-late BiLSTM) is copied from its experiment
folder into the site at build time. The browser runs them with tfjs on the CPU backend, chosen
because it gives the same numbers on every machine; WebGL does not. Inputs and outputs go through
the pipeline's own `buildWindow` and `outputsToPrediction` from `@tma/features`. A test runs three
committed models on both backends and finds the browser path within float32 tolerance of
`tfjs-node`.

One forward pass serves the whole window. The instantaneous model is causal, so its estimate at
time t depends only on bearings up to t: moving the cursor reads a different row, and the page
draws only the rows up to the cursor. Rows before the zig are shown but marked unobservable; the
gates never score them.

## Baselines

- **Classical, instantaneous mode:** the per-timestep least-squares solution, as `tma-eval` scores it.
- **Classical, time-late mode:** one batch solution over the whole window, drawn as a
  constant-velocity track.
- **Naive:** the training-set means recorded in the gate experiment's manifest.

The readout gives each estimator's range, bearing, course and speed at the cursor, with the error
against truth using the same `rowError` the evaluation uses. The summary gives the medians over
the post-zig rows, with a non-converged row counted as infinite error, as the gates count it.

## State and export

The dataset, index, mode, cursor time, model pair and overlays live in the URL query, so a link
reopens the same view. The PNG export stacks the plan and plots. The NDJSON export writes the
scenario and the shown predictions as canonical JSON in the schema's types, ready for the CLIs.

## Limits

- The viewer shows single cases. A striking case says nothing about frequency: use the gate
  experiments for that.
- The browser regenerates scenarios, so a later generator change would show different scenarios
  for the old seeds. The catalogue records the generator version it was built with.
