# Plan: Spec 017 — manoeuvre detection (gate G6)

## Constitution check (1.3.0)

- **I Types.** The detection records, `DetectorThreshold` and `ChangeDecision.detector_thresholds`
  are in `schema/tma.yaml` (0.19.0). The goldens change only in the schema version string.
- **II Determinism.**
  - The detectors are pure functions of seeded data.
  - The bootstrap and the re-computed sample use the gate's seed.
  - The IMM's rows are byte-identical: `innovation` is reported, not used.
- **III Portability.** Plain functions; one CLI per stage (`tma-detect` scores, `tma-g6` judges).
- **IV Baselines.** The baseline is the CUSUM, tuned to favour it. Naive and classical do not
  detect, so the CUSUM variants not carried are reported beside it.
- **V Gates.** A decision record precedes any test data. The panel decides the gate.

## Order

1. Schema, detectors, scoring, CLIs, tests.
2. Validation research.
3. Decision 33.
4. Data for seed 215, generated at or after decision 33.
5. The gate, then the agent panel, `review.md` and the write-up (a later PR).
