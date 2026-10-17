# Implementation Plan: Engagement and model viewer

**Spec**: [spec.md](spec.md) · **SRD**: Annex A Part A

## Constitution check (1.2.0)

| Principle | How it holds |
| --- | --- |
| I. Types from LinkML | The viewer uses `Scenario`, `Prediction`, `PredictionRow`, `NormalisationConstants`, `ParameterRanges` and `ModelManifest`; exports are those types. The URL state is not persisted as a record, so it is not a schema type. |
| II. Determinism | Scenarios come from the seeded generator; inference runs on tfjs's CPU backend, which is deterministic across machines (WebGL is not); a golden test pins a fixed scenario's view model. |
| III. Portability | `sim`, `features` and `classical` are reused through browser-safe subpath exports; the model-output decoding moves from `models` into `features` (pure) so the browser and the CLI share it. |
| IV. Baselines alongside | Classical estimates and naive numbers are shown beside every model figure. |
| V. Gates | No gate is affected; nothing is trained or scored. |

## Design

- **`packages/demos`** (`@tma/demos`), the slot SRD §6 names:
  - `src/core/*`: pure TypeScript, browser-safe: the dataset catalogue type, `scenarioAt`,
    plan-view geometry (bounds, grid spacing), per-scenario errors, inference glue (feature window
    → model → decoded rows) taking a tfjs `LayersModel`, classical and naive rows, URL state
    encode/decode, canonical NDJSON export.
  - `src/viewer/*`: the React component (TSX, compiled by `tsc`), SVG plots drawn by hand (no chart
    library), `@tensorflow/tfjs` loaded lazily with the CPU backend.
- **Browser-safe subpaths**: `@tma/features/browser` (layout, derived, normalise, decode),
  `@tma/classical/browser` (lsq, estimate, naive), `@tma/data/canonical`. `outputsToPrediction`
  moves from `models/src/predict.ts` to `features/src/decode.ts`; `models` re-exports it, so the
  CLI is unchanged and the goldens stay byte-identical.
- **Site**: `site/src/pages/viewer.jsx` mounts the component in `<BrowserOnly>`; `prebuild.mjs`
  writes `src/generated/viewer.json` (datasets from the plans and ranges files, the four carried
  pairs with their manifests' normalisation, feature set and source header, and each gate's naive
  means from its experiment manifest) and copies the eight models' `model.json` and `weights.bin`
  into `static/viewer/models/` (generated, git-ignored).
- **Datasets** (from the committed configs): iteration 1 (seed 101, `iter1-ranges`), iteration 2
  (seed 201, `iter2-ranges`, with its held-out split), the 2b test split (seed 202) and the 2c
  test split (seed 203); splits from `planSplits` (80/10/10 and held-out after them).
- **Tests** (`packages/demos/test`):
  - browser bundle: esbuild with `platform: browser` over the core, run in a `node:vm` context
    with no Node built-ins; scenarios equal the Node generator's byte for byte (FR-001);
  - agreement: the 2c LSTM and BiLSTM on fixed scenarios through the core on the CPU backend
    against `tfjs-node` via `@tma/models` (FR-007);
  - golden: a fixed scenario's view model (geometry, classical rows, errors), byte-identical;
  - a server render of the component, so a broken import or render fails CI.
- **Smoke**: Playwright (Chromium is installed) on the built site: the page loads, inference
  completes, no console errors, a screenshot per mode.

## Risks

- tfjs CPU inference for the 2c BiLSTM (538k parameters, 240 steps) may exceed two seconds on
  slow machines; the viewer shows progress and runs inference once per scenario and model.
- Iteration-1 models were trained on generator 0.1.x data; regenerated with 0.2.0 the iteration-1
  dataset still has an instantaneous zig (its ranges have no turn rate). The viewer shows the
  generator version and the model's source dataset.
