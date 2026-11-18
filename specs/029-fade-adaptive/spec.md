# Spec 029: a fading range weight and adaptive process noise

**Requirements:** SRD Annex G (owner decisions G1–G3); Annex F §F.6 and its panel review (the
straight-leg cost of the EKF fusion).

## Goal

Remove the EKF-fused tracker's straight-leg cost against the re-tuned EKF while keeping its overall
gain, and gate that.

## Requirements

- **FR-001** `fadedSd` and `ekfLogRangeSd`: T2's sd inflated by c · s / σ_f when σ_f < c · s;
  `--fade c`, name suffix `-f<c>`; EKF fusion only.
- **FR-002** `adaptedSigmaA`, `ekfBearingNis`, `ADAPT_WINDOW` 6: σa_eff from the averaged bearing
  NIS; `--adapt-hi`, `--adapt-eta`, suffix `-a<a>-e<e>`; `ekfPredict` takes the settings.
- **FR-003** `straightRow` and the gated `g5-straight-course` check (`tma-g5 --straight-leg`,
  decision field `straight_leg_check`, schema 0.24.0); both directions refused when they disagree.
- **FR-004** Names round-trip (`parseFusedEkfName`) and spec 015's re-computation binds them.
- **FR-005** Annex G §G.3's selection, committed before any variant is scored.

## Tasks

- [x] T001 FR-001–FR-004 with tests; Annex G, the grid, the probe, `spec029-rows.mjs`,
      `spec029-fuse-grid.mjs`, `run.sh`, committed before any scoring
- [ ] T002 Validation (`experiments/20261118-p16-val/`): grid, select; `validation.md`
- [ ] T003 If carried: decision 44 (seed 236), plan, data from a clean tree
- [ ] T004 If carried: G5 + straight-leg on seed 236, panel review, write-ups
- [ ] T005 Algorithm note, go/no-go report, blog post, AGENTS.md
