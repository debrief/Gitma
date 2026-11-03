# Plan: Spec 016 — guarded (re-)initialisation for the EKF and IMM

## Constitution check (1.3.0)

- **I Types.** There is no schema change. The setting is a tracker parameter carried in the
  estimator name, as `p0Scale` and `rScale` are.
- **II Determinism.** Pure functions, with no PRNG involved. Level 0 is byte-identical: the golden
  tracker rows are unchanged, and the frozen references and committed verdicts reproduce.
- **III Portability.** `@tma/classical` stays plain functions over typed arrays.
- **IV Baselines.** The validation comparison reports each guarded tracker beside its frozen self,
  with naive and classical figures in the same `report.json`.
- **V Gates.** No gate is judged, no test split is touched, and no reference is re-frozen.

## Design

| Piece | Where |
| --- | --- |
| `GuardedInit` (0, 1 or 2), and `scaleSuffix` `-g1`/`-g2` | `ekf.ts` |
| `ekfInitialiseGuarded`: the closest-approach guard, Householder QR with a condition guard, and P₀ = σ²p0 · R⁻¹R⁻ᵀ at tᵢ | `ekf.ts` |
| `initialiseAt`: level 0 is `ekfInitialise`; level 2 re-initialisations try the last 60 samples first | `ekf.ts` |
| `immInitialise(…, level, reinit)`; `ImmParams.guardedInit` | `imm.ts` |
| Name parsers accept `-g1`/`-g2` (round trip) | `names.ts` |
| `--guarded-init 1\|2` | `cli-track.ts`, `cli-fuse-track.ts` |

**The thresholds, and why:**
- **100 m** is the generator's `min_range_m`. No true track comes closer, so a fit that does is
  not a target.
- **10⁷ on R** is about 10¹⁴ on JᵀJ, two orders below the failures seen (about 10¹⁶) and two above
  healthy first initialisations (about 10¹¹ on JᵀJ).
- **60 samples** is 10 min. It is long enough to span a target leg, and short enough to exclude
  the manoeuvres that make the full-history constant-velocity fit wrong.

## Research (validation, seed 211)

`experiments/20261103-guarded-init-val/run.sh`:
- the IMM, the EKF and the fused tracker at levels 0, 1 and 2;
- `tma-g5` diagnostics of levels 1 and 2 against level 0;
- non-PD and non-converged counts.
