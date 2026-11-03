# Tasks: Spec 016 — guarded (re-)initialisation for the EKF and IMM

- [x] T001 Owner decision: opt-in under a new name, measured on validation (2026-11-03)
- [x] T002 `ekfInitialiseGuarded`, `initialiseAt`, `GuardedInit`; IMM wiring (FR-001, FR-002)
- [x] T003 Names, parsers, `--guarded-init` on `tma-track` and `tma-fuse-track` (FR-003)
- [x] T004 Tests, each level passing and refusing:
  - level 0 equals the frozen initialiser and rows, and the golden is unchanged;
  - square-root P₀ equals σ²(JᵀJ)⁻¹ on healthy fits;
  - the seed-214 360417 degenerate fits are refused (g1) or re-fitted PD from the window (g2);
  - no non-PD IMM step where the frozen IMM has some;
  - names and CLI levels.
- [x] T005 Validation research (FR-005): `experiments/20261103-guarded-init-val/`; `research.md`
  (level 1 neutral and numerically safe; level 2 rejected)
- [x] T006 Site: trackers note; AGENTS.md
