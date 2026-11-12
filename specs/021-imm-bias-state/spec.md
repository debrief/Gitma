# Spec 021: Phase 9 — an IMM with a bearing-bias state (gate G8)

**Requirements:** SRD Annex C §C.16 (owner decisions 2026-11-12); decisions 29, 32 and 35; spec 020
(G8).

## Goal

Find out whether a classical IMM that models a drifting bearing bias closes the range gap to T2
under realistic bearing error. It should beat T2 alone on range and pass G5 against the frozen
`-g1` IMM. Nothing is trained.

## Functional requirements

- **FR-001 Bias state** (`ImmParams.biasSdDeg`, `biasTauS`; name suffix `-b<sd>-tb<τ>`;
  `tma-track --bias-sd --bias-tau`):
  - b is a sixth state, a Gauss–Markov bias with discrete noise sd²(1 − e^(−2τ/τ_b));
  - the predicted bearing is bearingOf(dx, dy) + b, so H gains a 1;
  - b is initialised at 0 with variance sd²;
  - the name parses back to the same settings;
  - the 5-state IMM is byte-identical (golden).
- **FR-002 Research grid** (`scripts/research/spec021-grid.mjs`): 18 variants on seed 217
  validation, with §C.16's selection applied mechanically. The output is `grid.json` and a
  validation note.
- **FR-003 Decision and gate** (if carried): decision 37, plan `configs/phase4/y`, seed 222, and G8
  by `tma-g5 --beat`, judged by the agent panel.

## Out of scope

- Re-tuning the IMM's motion noise.
- Bias estimation from ownship manoeuvres designed for it.
- Other error models.
