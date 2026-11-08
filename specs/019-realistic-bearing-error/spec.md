# Spec 019: Phase 7 — realistic bearing error (G5 rules, frozen trackers)

**Requirements:** SRD Annex C §C.6 item 3 and §C.14 (owner decisions 2026-11-08); decisions 31
and 32.

## Goal

Judge whether the frozen fused tracker still beats the frozen reference IMM under G5's rules
when the bearings carry correlated error and a drifting bias, which neither tracker nor T2 has
seen. Nothing is trained, re-tuned or refitted.

## Functional requirements

- **FR-001 Generator 0.6.0** (schema 0.21.0 `BearingErrorModel`):
  - `ParameterRanges.bearing_error` adds a Gauss–Markov correlated term and a Gauss–Markov bias
    to every bearing of a σ > 0 scenario (`bearingErrors`, stream sub-index 2), recorded in
    `ScenarioParameters.bearing_error`;
  - without it, or at σ = 0, scenarios are byte-identical to 0.5.0's;
  - `configs/phase7-ranges.json` is the phase-4 ranges plus 1.0° / 30 s and 0.5° / 1,200 s
    (owner, 2026-11-08).
- **FR-002 G0 on 0.6.0.**
  - The check `bearing-error-model` covers the residual sd, its mean, and its correlations at
    lags of 1, 3, 12, 60 and 120 samples, within about 4 SE.
  - The tracker checks regenerate without the bearing error.
  - G0 is re-run on noise-free 0.6.0 data and reviewed by the agent panel.
- **FR-003 Plans.** `dataset.fresh_test.ranges` generates the fresh test split with other ranges,
  while training data and normalisation stay the plan's (seed 211).
- **FR-004 Research, decision and gate.**
  - **Validation diagnostic.** `tma-g5` on seed 217's validation split with the phase-7 ranges.
  - **Paired clean comparison** on the same rows (phase-4 ranges, same seed), reported.
  - **The decision record** freezes the names, the plan and seed 218. Its carry rule is that
    every point estimate is within its limit.
  - **The gate.** G5 is scored on seed 218 by `tma-g5` with spec 015's bindings, and judged by
    the agent panel.

## Out of scope

- Training, re-tuning, or refitting the fusion's k and M.
- Other error models or severities, real data, and adapting the trackers to correlated error
  (for example state augmentation with a bias term).
