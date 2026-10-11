# Contract: File Formats

Field definitions live in `schema/tma.yaml`; this page fixes the byte layout.

## `.ndjson` (inspection)

- UTF-8, `\n` line endings, no trailing whitespace, final newline.
- Line 1: `DatasetHeader` record with `"record": "header"`.
- Lines 2…: one `Scenario` per line with `"record": "scenario"`.
- Canonical JSON: object keys sorted alphabetically at every level, no whitespace. (Schema slot
  order is not used: zod re-orders keys on parse, and sorted keys are trivial to reproduce in a port.)
- Numbers: JS shortest round-trip string of the float32-rounded value (negative zero is stored as
  +0, since JSON cannot represent it); integers without decimal point;
  `seed` as a decimal string (uint64 exceeds JS safe integers).

## `.f32pack` (training)

All little-endian.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | magic `TMAPACK\0` |
| 8 | 4 | uint32 pack format version (starts at 1) |
| 12 | 4 | uint32 header JSON length `H` |
| 16 | H | UTF-8 `DatasetHeader` JSON, padded with spaces to a multiple of 4 |
| 16+H | 4 | uint32 scenario count `N` |
| … | 8·(N+1) | uint64 byte offsets of each scenario block + end offset |
| … | — | scenario blocks |

Scenario block:

| Field | Encoding |
| --- | --- |
| metadata length `M` | uint32 |
| metadata | UTF-8 canonical `ScenarioMetadata` JSON, space-padded to a multiple of 4 |
| samples `S` | uint32 |
| ownship | Float32 × S × 5 (timestamp_s, x_m, y_m, course_rad, speed_mps), row-major |
| target | Float32 × S × 5 |
| observations | Float32 × S × 3 (timestamp_s, bearing_rad, valid as 0/1) |

## Predictions `.ndjson`

Line 1 header `{ "record": "header", "estimator", "mode", "dataset_digest", "schema_version" }`; then
one `Prediction` per line. `dataset_digest` = SHA-256 of the truth file; `tma-eval` rejects mismatches.

## `experiments/<id>/`

| File | Content |
| --- | --- |
| `manifest.json` | `ExperimentManifest` |
| `metrics.csv` / `metrics.json` | `MetricsRecord` rows (same data, two encodings) |
| `curves.csv` | metric vs `t_since_zig_s` per estimator (per-timestep mode only) |
| `verdict.json` | `GateVerdict` |
| `seeds.txt` | dataset seed and index ranges per split |

Datasets themselves are **not** committed (regenerable from seeds); `experiments/` is.

## Golden files

`packages/<pkg>/test/golden/` holds small committed outputs (≤ 50 scenarios, fixed seed). Test compares
bytes exactly under the pinned Node version (see [research R3](../research.md#r3-cross-platform-determinism--risk-found)).
