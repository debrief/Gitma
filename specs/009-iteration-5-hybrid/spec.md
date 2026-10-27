# Feature Specification: Iteration 5 — Hybrid Estimator (Gate G3)

**Feature Branch**: `009-iteration-5-hybrid`

**Created**: 2026-10-27

**Status**: Planned. The owner chose G3 through model levers, starting with the per-leg fit
(B.2.3), on 2026-10-27. Research R1 showed that fit carries no usable range rate at the gate
points. The owner then switched to the hybrid (B.2.6): first network-initialised, then the
disagreement switch, after research R2 (decision 24).

**Input**: G2 passed on the iteration-4 re-score (`experiments/20261025-i4-g2-rescore/`). The
instantaneous LSTM reaches 0.939 kt against classical's 0.319 kt, so the models are 2.1–3.5 ×
classical. G3 (SRD §5) asks for "within 1.2× classical on every metric, and lower gross-error
rate". Classical's gross-error rate five minutes after the zig is 1.1–1.3%; the LSTM's is
0.8–1.0%.

**SRD trace**: §5 (the G3 criterion and metrics); Annex A Part B: lever B.2.6 under the rules of
B.3; §8 (panel, decision 24); §9 (blog, results).

**Out of scope**:
- New training. The network is the frozen iteration-4 instantaneous LSTM.
- Changes to the problem: generator 0.3.0 and iteration 3's ranges are kept.
- The EKF reference (SRD §4: only if G3 is reached).
- Real data.

## The claim

A **hybrid**, not "a network alone" (Annex A B.2.6). The estimator is classical's least-squares
solution, replaced by the network's estimate where the two disagree:

- **When it switches.** At each timestep the hybrid reports the classical row, unless classical
  has no converged plausible estimate, or the two ranges differ by more than 50% of the network's
  range (`SWITCH_RANGE_REL`, the same bound as a gross error).
- **Then** it reports the network's row.
- **Causal.** The network is the causal instantaneous model, so the hybrid is causal.

## User stories

### US1 — Build the hybrid (P1)

`hybridSwitch` in `@tma/classical` and the `tma-hybrid` CLI turn a classical and a network
per-timestep prediction file into a hybrid prediction file.

**Acceptance**:
- The rows are classical's except where the rule switches.
- Mismatched scenarios, times or modes are refused.

### US2 — Judge G3 (P1)

`tma-g3` judges G3 for the hybrid against classical (`gate-g3.ts`). A test split needs the
committed decision; any other split gives a diagnostic.

### US3 — Pre-register, validate, gate, record (P1)

- **Before test.** The decision record (forecast, rule, seed 207) is committed before any
  seed-207 data exist. The validation diagnostic on seed 205 is read before test scoring.
- **Then** test scoring, the agent panel, `review.md`, `decided_by`, a results page and a blog
  post.

## Functional requirements

- **FR-001**: The hybrid row is classical's unless `useNetwork`: classical not converged (or not
  plausible), or |r_classical − r_network| / r_network > 0.5. Then it is the network's row.
- **FR-002**: The network is the iteration-4 `lstm-instantaneous`, bound by the SHA-256 of its
  `weights.bin`, `manifest.json` and `model.json` in the decision record. It is scored with its
  own normalisation (from its manifest) on the derived feature set.
- **FR-003**: Classical is `tma-solve --per-timestep` with the default options (50 iterations,
  grid every 6 rows), unchanged.
- **FR-004**: The test split is the test split of fresh seed 207: 20,000 scenarios, indices
  180,000–199,999 of a 200,000-scenario dataset under `configs/iter4-ranges.json` (generator
  0.3.0), generated alone by `scripts/generate-splits.mjs` from a clean tree. Seed 207 is
  reserved.
- **FR-005**: `tma-g3` refuses a test split without a committed decision whose `test_seed` is
  the data's seed, test data from a dirty tree, and a second scoring into the same folder.
- **FR-006 (validation rule, B.3.3).** On seed 205's validation split, the hybrid's diagnostic
  must show:
  - every ratio check passing;
  - the gross-error difference interval wholly below 0.

  Otherwise the iteration stops at validation.
- **FR-007 (G3 rule).** On the σ = 1° slice, with paired bootstrap 95% intervals (2,000
  resamples, seed 20261011) and the FR-015 rule:
  - **Ratios.** Hybrid / classical for the median and the P90 of range error and course error at
    zig + 300 s, and of speed error at zig + 600 s, against 1.2.
  - **Gross errors.** The hybrid's gross-error rate minus classical's at zig + 300 s, against 0.
  - **Result.** G3 passes only if all seven pass. Any fail is a fail; otherwise inconclusive.
  - **Not a stop condition.** SRD §5.
- **FR-008**: Everything reported sits beside naive and classical on the same rows: tma-eval
  metrics for naive, classical, the LSTM and the hybrid, plus the share of rows switched.
- **FR-009**: Position error (the time-late metric) is not part of G3 here. The hybrid is an
  instantaneous estimator.

## Success criteria

- **SC-001**: One scoring of seed 207's test split, after the decision and the validation
  diagnostic are committed.
- **SC-002**: The write-up calls the result a hybrid result and says what it does not show:
  - that a network alone matches classical;
  - performance on target manoeuvres or real data.

## Risks

- **The claim is narrow.** The hybrid's accuracy is classical's. What it adds is fewer gross
  errors, from the network's estimate where least squares lands far from the truth (R2).
- **A rule chosen on validation.** The 50% threshold equals the gross-error bound and was not
  tuned. Seed 205's validation split informed the choice of rule, which is why the gate uses
  fresh seed 207.
- **The network's own gross errors.** Where classical is right and the network is more than 50%
  off, the switch fails. On validation that happened less often than the reverse.
