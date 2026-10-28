# Tasks: Phase 3 — manoeuvring targets and G4

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md) · **Annex**: [SRD Annex B](../../docs/SRD-annex-B.md)

## PR 1 — Documentary (this PR)

- [x] T001 SRD Annex B; main-body amendments (§2, §3, §4, §5, §7, §8); Annex A D7
- [x] T002 Spec 010: spec, research plan, tasks; AGENTS.md; glossary (EKF, manoeuvre, G4)

## PR 2 — Generator 0.4.0, EKF, G0

- [ ] T003 Schema bump: `manoeuvre_index`, `manoeuvre_angle_rad`, manoeuvre ranges;
  `pnpm schema:gen`
- [ ] T004 Generator 0.4.0: rate-limited target turn (FR-001); goldens; known-answer tests;
  held-course scenarios unchanged in shape
- [ ] T005 `sliceKeys` manoeuvre band (FR-002)
- [ ] T006 `@tma/classical` EKF (FR-003), `tma-ekf` CLI, noise-free and straight-target
  verification (US2)
- [ ] T007 Viewer: the target's turn shown; EKF selectable
- [ ] T008 G0 re-run on 0.4.0; agent panel; `review.md`; `decided_by`

## PR 3 — Research, decision, training plan

- [ ] T009 Research R1–R4 on the phase-3 validation split
- [ ] T010 EKF tuning script and the two frozen σ_a (FR-004)
- [ ] T011 `gate-g4.ts`, `tma-g4` (FR-008, FR-009); tests
- [ ] T012 Decision record (carried model, config, forecast, EKF tunings, fresh seed 208);
  plan `configs/phase3/a`; seed reserved

## Run

- [ ] T013 `train/p3a` on CI; validation diagnostic (FR-007)
- [ ] T014 G4 on the test split; agent panel; `review.md`; `decided_by`
- [ ] T015 Write-up: results page, blog post, AGENTS.md; the follow-on Annex B §B.5 selects
