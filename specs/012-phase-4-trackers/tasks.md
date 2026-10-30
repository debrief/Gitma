# Tasks: Phase 4 — end-to-end learned trackers

- [x] T001 SRD Annex C, main-body amendments, constitution 1.3.0, glossary, plan post (PR 1)
- [x] T002 Schema 0.15.0: `TargetManoeuvre`, `ManoeuvreSpan`, `ManoeuvreKind`, 0.5.0 ranges fields
- [x] T003 Generator 0.5.0: count stream, planning, closed-form segments; `configs/phase4-ranges.json`
- [x] T004 G0 checks: known answers, `targetManoeuvresFailure`, `manoeuvreTimingFailure`; tests
- [ ] T005 G0 re-run on 0.5.0 (seed 42, 100,000, noise-free); agent panel; `review.md`
- [ ] T006 References re-tuned on phase-4 validation (seed 211); EKF/IMM grid; frozen reference
- [ ] T007 T1 learned-gain filter layer (algorithm note; fixed-gain = EKF test); T2 NLL head
- [ ] T008 Training-cost measurements; `tma-g5`; decision record (seeds, configs, forecast)
- [ ] T009 Training on CI, both trackers
- [ ] T010 Validation diagnostic; G5 on the fresh test seed for each tracker carried; panel
- [ ] T011 Write-up
