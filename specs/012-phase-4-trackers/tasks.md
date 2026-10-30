# Tasks: Phase 4 — end-to-end learned trackers

- [x] T001 SRD Annex C, main-body amendments, constitution 1.3.0, glossary, plan post (PR 1)
- [x] T002 Schema 0.15.0: `TargetManoeuvre`, `ManoeuvreSpan`, `ManoeuvreKind`, 0.5.0 ranges fields
- [x] T003 Generator 0.5.0: count stream, planning, closed-form segments; `configs/phase4-ranges.json`
- [x] T004 G0 checks: known answers, `targetManoeuvresFailure`, `manoeuvreTimingFailure`; tests
- [x] T005 G0 re-run on 0.5.0 (seed 42, 100,000, noise-free); agent panel; `review.md` — passed, panel rounds 1–3 (`experiments/20261030-g0-p4-r3/`)
- [x] T006 References re-tuned on phase-4 validation (seed 211); EKF/IMM grid; frozen reference —
  `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8`, 9.24% (research R2)
- [x] T007 T1 learned-gain filter layer (algorithm note; fixed-gain = EKF test); T2 NLL head
  (prerequisites found by the G0 panel: `features` rows per window now come from the source's
  ranges, `rowsFor`: 240 up to phase 3, 360 for 60-min windows — done; `velocity_two_hypothesis` training refuses 0.5.0 data, as
  `tma-g4` does — done; open: the viewer draws one target turn)
- [x] T008 Training-cost measurements; `tma-g5`; decision record (seeds, configs, forecast)
  (from the G0 panel: `tma-g5` reuses `settled()` from `scripts/research/spec012-distribution.mjs`,
  with a test that they agree on G0 data; the decision record reports the settled checks by gate time
  as well as pooled; and it states that the count–window correlation, which over-weights busy
  scenarios at later gate times, is the intended estimand, and that the speed-change side prior
  favours learned trackers — all done: research R1, R3; decision 29)
- [ ] T009 Training on CI, both trackers
- [ ] T010 Validation diagnostic; G5 on the fresh test seed for each tracker carried; panel
- [ ] T011 Write-up
