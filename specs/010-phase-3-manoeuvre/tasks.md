# Tasks: Phase 3 — manoeuvring targets and G4

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md) · **Annex**: [SRD Annex B](../../docs/SRD-annex-B.md)

## PR 1 — Documentary (this PR)

- [x] T001 SRD Annex B; main-body amendments (§2, §3, §4, §5, §7, §8); Annex A D7
- [x] T002 Spec 010: spec, research plan, tasks; AGENTS.md; glossary (EKF, manoeuvre, G4)

## PR 2 — Generator 0.4.0, trackers, G0

- [x] T003 Schema 0.12.0: manoeuvre metadata and parameters, manoeuvre ranges; `pnpm schema:gen`
- [x] T004 Generator 0.4.0: rate-limited target turn (FR-001); goldens; known-answer tests;
  older ranges byte-identical
- [x] T005 `sliceKeys` manoeuvre band (FR-002)
- [x] T006 `@tma/classical` EKF and IMM (FR-003, amended), `tma-track` CLI, noise-free
  verification (US2); the single EKF's drift after a turn found and recorded (Annex B §B.3)
- [x] T007 Viewer: the target's turn marked; IMM selectable; phase-3 preview source (seed 900)
- [ ] T008 G0 re-run on 0.4.0 (`experiments/20261028-g0-p3/`); agent panel; `review.md`;
  `decided_by`

## PR 3 — Research, decision, training plan

- [ ] T009 Research R1–R4 on the phase-3 validation split
- [ ] T010 Tracker tuning script and the two frozen IMM settings (FR-004); the tuned single EKF
  reported
- [ ] T011 `gate-g4.ts`, `tma-g4` (FR-008, FR-009); tests
- [ ] T012 Decision record (carried model, config, forecast, IMM tunings, fresh seed 208);
  plan `configs/phase3/a`; seed reserved

## Run

- [ ] T013 `train/p3a` on CI; validation diagnostic (FR-007)
- [ ] T014 G4 on the test split; agent panel; `review.md`; `decided_by`
- [ ] T015 Write-up: results page, blog post, AGENTS.md; the follow-on Annex B §B.5 selects
