# Tasks: Spec 017 — manoeuvre detection (gate G6)

- [x] T001 Owner decisions (2026-11-05): a detector from frozen models with no training; delay at
      matched false alarms
- [x] T002 Schema 0.19.0: detection records, `DetectorThreshold`, `ChangeDecision.detector_thresholds`; G6
- [x] T003 `cusumDetect` (nis, mean; clipped), `disagreementDetect`, `courseRateDetect`; names and
      parsers; IMM `innovation`
- [x] T004 `gate-g6.ts`, `detection-file.ts`, `tma-detect`, `tma-g6`; tests (pass and refuse)
- [x] T005 Validation research (`experiments/20261105-p5-research/`): CUSUM grid and learned
      candidates at 0.5 false alarms per hour
- [x] T006 Validation rule applied: the learned detector is **not carried** (G6-detect5
      −8.95 pp [−10.16, −7.73]). No decision 33, no seed-215 data; the owner decides the follow-on.
- [x] T007 Write-up: `site/blog/2026-11-05-phase-5.md`; detection algorithm note; glossary
