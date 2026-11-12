# Phase 9 validation: an IMM with a bearing-bias state (spec 021, SRD Annex C §C.16)

**Result: no variant is carried, and phase 9 stops at validation, as forecast.** Seed 222 is never
generated, and no G8 is scored.

**Data.** Seed 217's 10,000-scenario validation split with realistic bearing error, generated clean
at d6e9866: 16,711 G5 rows, of which 7,509 are settled.

**Grid.** The 18 variants are bias sd ∈ {0.25°, 0.5°, 1°} × τ ∈ {600, 1,200, 2,400} s × r ∈
{4, 8}, each on the `-g1` IMM's motion settings.

**Pre-registration.** The selection (`scripts/research/spec021-grid.mjs`) and `run.sh` were
committed before any variant was scored. Results are in `grid.json` and hashes in
`predictions.sha256`.

## The grid: point ratios of medians

The first five columns are candidate / frozen `-g1` IMM; "/ T2" is candidate / T2 range.

| Bias sd | τ (s) | r | Range | Course | Settled range | Settled course | Settled speed | Range / T2 | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.25° | 600 | 4 | 1.063 | 1.077 | 1.067 | 1.139 | 1.113 | 1.457 | −0.457 |
| **0.25°** | **600** | **8** | **0.998** | 0.996 | 1.001 | 0.995 | 0.985 | **1.368** | **−0.368** |
| 0.25° | 1,200 | 4 | 1.064 | 1.080 | 1.064 | 1.135 | 1.115 | 1.458 | −0.458 |
| 0.25° | 1,200 | 8 | 0.999 | 0.996 | 1.001 | 0.997 | 0.987 | 1.369 | −0.369 |
| 0.25° | 2,400 | 4 | 1.066 | 1.074 | 1.065 | 1.136 | 1.121 | 1.461 | −0.461 |
| 0.25° | 2,400 | 8 | 1.000 | 0.997 | 1.002 | 0.994 | 0.986 | 1.370 | −0.370 |
| 0.5° | 600 | 4 | 1.068 | 1.065 | 1.063 | 1.121 | 1.107 | 1.464 | −0.464 |
| 0.5° | 600 | 8 | 1.007 | 0.995 | 1.009 | 0.990 | 0.979 | 1.379 | −0.380 |
| 0.5° | 1,200 | 4 | 1.071 | 1.074 | 1.070 | 1.127 | 1.106 | 1.468 | −0.468 |
| 0.5° | 1,200 | 8 | 1.008 | 0.999 | 1.015 | 0.997 | 0.987 | 1.382 | −0.382 |
| 0.5° | 2,400 | 4 | 1.068 | 1.081 | 1.064 | 1.131 | 1.108 | 1.464 | −0.464 |
| 0.5° | 2,400 | 8 | 1.008 | 1.000 | 1.010 | 0.994 | 0.983 | 1.382 | −0.382 |
| 1° | 600 | 4 | 1.100 | 1.051 | 1.087 | 1.059 | 1.101 | 1.508 | −0.508 |
| 1° | 600 | 8 | 1.052 | 1.020 | 1.058 | 0.993 | 0.982 | 1.442 | −0.442 |
| 1° | 1,200 | 4 | 1.109 | 1.058 | 1.089 | 1.086 | 1.107 | 1.520 | −0.520 |
| 1° | 1,200 | 8 | 1.057 | 1.023 | 1.057 | 1.007 | 0.991 | 1.449 | −0.449 |
| 1° | 2,400 | 4 | 1.117 | 1.063 | 1.104 | 1.118 | 1.113 | 1.530 | −0.530 |
| 1° | 2,400 | 8 | 1.062 | 1.022 | 1.062 | 1.011 | 0.993 | 1.456 | −0.456 |

**The rule's choice.**
- The best score is −0.368, at 0.25° / 600 s / r 8.
- The tie rule (within 0.005, then the smaller bias sd and the larger r) selects 0.25° / 1,200 s /
  r 8, at −0.369.
- Both are far below 0, so nothing is carried. Every variant is bound by candidate/T2 range.

## Reading

- **The bias state does not help.** At best the candidate equals the frozen IMM: range 0.998,
  course 0.996, settled ratios within 1.5%. A larger bias sd or a smaller r makes it worse: range
  up to 1.12 × and settled course up to 1.14 ×.
- **It stays about 1.37–1.53 × T2's range error.** A classical filter that models the bias does
  not close the gap.
- **Why: the bias is nearly unobservable.** This was forecast in §C.14 and recorded before scoring.
  In these geometries a constant or slowly drifting bearing offset is absorbed by a small rotation
  of the solution. One or two ownship zigs do not separate the two, and the bias state's prior
  only adds freedom that the bearings cannot constrain. T2 does better on range plausibly because
  it learns range from the whole bearing history rather than from bearing geometry alone. That is
  not tested here.
- **Limits.** This is one error model, validation only, a single in-sample grid, and frozen motion
  settings.

**Next: the owner decides.** C.14's and C.15's results stand.
