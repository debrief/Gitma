# Spec 015: Tighten the G5 gate's bindings

**Requirements:** SRD Annex C §C.5 (G5: fresh test seed, scored once, frozen settings), §C.10
(phase 4b: θ frozen in decision 30), §C.11 (phase 4c: k, M and the IMM frozen in decision 31).
SRD §5 and constitution 1.3.0 (gates bound to their pre-registered decisions).

**Sources:** the follow-ups the phase-4b and phase-4c agent panels recorded:
`experiments/20261102-p4f-g5/review.md` rows 5, 6, 19, 20 and 25;
`experiments/20261102-p4f-g5/g5.md` ("Binding limits (follow-ups)");
`experiments/20261101-p4h-g5/review.md`.

## Goal

Close the gaps by which `tma-g5` could accept a test split that does not match its decision. No
gate is judged and nothing is trained; the committed verdicts must re-score unchanged.

## Functional requirements

- **FR-001 Re-computed sample.** On a test split, `tma-g5` re-computes the carried trackers' and
  the reference's rows on a seeded sample of 200 scenarios (seed 20261011, the gate's bootstrap
  seed; drawn from the scenarios with G5 rows). It uses the settings their estimator names
  declare, through `immPredict`, `ekfPredict`, `fusedPredict` and `trackerHybrid`. Inputs are
  resolved among the files given, by estimator and SHA-256, and are themselves re-computed where
  they can be. Every stored line must equal the re-computed one byte for byte; otherwise the gate
  refuses. A network's own file (it names its weights) is used as stored.
  - **Settings from names.** Names are parsed, and each parse must give back the same name
    through its namer (`immName`, `ekfName`, `fusedName`, `trackerHybridName`). A non-canonical
    or unknown name is refused, not read loosely. No header fields are added (research R1).
- **FR-002 Data postdate the decision.** On a test split the data must come from a clean tree, at
  the commit that added the decision or a descendant of it (`git merge-base --is-ancestor`). This
  holds on every path, including frozen models (`model_digests`), where the check used to be
  skipped.
- **FR-003 Scored once across experiments.** `tma-g5` writes `scoring.json` (schema 0.18.0
  `GateScoring`) beside `verdict.json`. It records the decision (path and SHA-256), the test seed,
  the truth file's SHA-256, the re-computed estimators and any `repeat_of`.
  - The gate refuses when another experiment under `experiments/` records G5 for the same decision
    (path or digest) and test seed.
  - It also refuses beside any G5 verdict that has no `scoring.json`, since it cannot tell what
    that one scored.
  - `--repeat-of <experiment>` allows a reproduction. It must name an experiment that scored the
    same decision and seed. A reproduction is not a second chance at the gate: C.5's one
    re-score is on a fresh, larger seed, so it has a different seed.
  - The two committed G5 experiments get a backfilled `scoring.json`; their verdicts are
    unchanged.
- **FR-004 Fused-tracker guards.** `fusedPredict` skips a network row whose `range_m` is ≤ 0 or
  not finite, or whose `log_range_sd` is absent, ≤ 0 or not finite (`usableRange`). Tests show
  that such a row is skipped. They also show that rows a network can state pass through
  unchanged. On the phase-4c test rows no row triggers the guard (research R4).
- **FR-005 G3 binding (optional item).** On a test split `tma-g3` also requires:
  - data postdating the decision;
  - the plans the decision names (`plan` or `plans`), with their digests checked;
  - when it freezes models (`model_digests`), the `--model` directories byte for byte, and a
    hybrid file that traces to their weights through its inputs and `--network`.

  `tma-hybrid` records its inputs (schema 0.18.0).
- **FR-006 Report only: the reference IMM's covariance.** Investigate the panel's
  non-positive-definite CV covariance (seed 214, scenario 360417, sample 152), and write up its
  cause and a proposed fix. The frozen IMM is not changed (research R5).

## Regression (acceptance)

- Regenerate the phase-4b (`configs/phase4/h`) and phase-4c (`configs/phase4/f`) test data, one
  phase at a time. Follow each experiment's `run.sh` with the new build, and add
  `--repeat-of <committed experiment>`. Both gates must pass under the new checks, with
  `checks` in `verdict.json` identical to the committed ones.
- Show each new check refusing a tampered case on real data:
  - a renamed fused or hybrid file;
  - one changed row;
  - a second scoring without `--repeat-of`.
- Every new check has a passing and a refusing unit test.

## Out of scope

- Changing the frozen IMM, T2, θ, k or M.
- Re-computing a network's rows inside the gate: it needs the model runtime (tfjs), and the weights
  are bound by digest.
- Re-computing tma-g3's classical/hybrid rows. G3 is judged on the file chain only.
