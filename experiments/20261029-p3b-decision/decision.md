# Phase 3b decision: a two-hypothesis output (decision 27)

The decision is committed before the model is trained and before any seed-210 data exist.
- **Spec:** `specs/011-phase-3b-two-hypothesis/`.
- **Annex:** `docs/SRD-annex-B.md` §B.8.
- **Owner decisions, 2026-10-29:** a two-hypothesis output, with a supervised turn flag.

## The carried network

- **Model.** `lstm-two-hypothesis` (`configs/phase3/b/instantaneous.json`). It is phase 3a's
  configuration with `output_parameterisation: velocity_two_hypothesis` and
  `loss_weight_manoeuvre: 1`.
- **Unchanged from phase 3a:**
  - architecture: 2 × 128 LSTM layers;
  - derived features;
  - `loss_weight_speed` 4;
  - train seed 1001, patience 6, from scratch.
- **Training.** On seed 208's train split (plan `configs/phase3/b/plan.json`), the same data as
  phase 3a.
- **Reported estimate.** The hypothesis with P(turned) > 0.5.

## What is held fixed

- **The frozen reference.** `imm-cv0.003-ct0.1-w0.001-s0.001-r2`, from decision 26 (research
  R2).
- **The G4 checks.** Rows, statistics and limits as decision 26, using `gate-g4.ts` unchanged.
- **The validation rule (FR-002).** On seed 208's validation split, carry to test only if all of
  these hold:
  - G4-range and G4-course: point estimate below 1, interval not wholly at or above 1;
  - all three G4-control checks pass.

  Otherwise phase 3b stops at validation. It is written up, and Annex B §B.5's second branch
  applies with no further attempt under this annex.
- **G4.** `tma-g4 --decision experiments/20261029-p3b-decision/decision.json --plan
  configs/phase3/b/plan.json --model <the trained model>`, on the test split of fresh seed 210:
  - a 400,000-scenario dataset, so 40,000 test scenarios;
  - generated alone, with the content digest pinned in the plan.

  One re-score on a larger fresh seed is allowed if the result is inconclusive.
- **Reported beside it.** Phase 3a's network on the same validation rows, and the turn flag's
  detection:
  - its false-alarm rate on held-course rows at zig + 300 s;
  - its median delay from the turn's start to P > 0.5;
  - its miss rate at manoeuvre + 300 s.

## Forecast, recorded before training

Phase 3a on the same validation split:

| Rows | Range | Course | Speed |
| --- | --- | --- | --- |
| After a turn | 10.5% | 14.4° | 1.57 kt |
| Held course | 7.6% | 11.1° | 1.60 kt |

The IMM reaches 13.6% and 24.1° after a turn. On held course it reaches 5.2%, 5.0° and 0.71 kt.

- **Held course.** If the flag is mostly right, the network reports a non-averaged estimate on
  held course. Its held-course figures should then return towards the iteration-4 LSTM's on
  phase-3 data: 6.4%, 4.7° and 0.87 kt (R3).
  - Course control passes, with a central estimate of about 6°.
  - Speed is the risk: the iteration-4 LSTM was 0.87 kt, and false alarms pull it up. The
    central estimate is about 0.95 kt, with a plausible range of 0.8–1.2 kt.
- **After a turn.** The network reports the turned hypothesis only once P > 0.5.
  - About 20% of turns are not yet visible by the gate point (R1). On those rows the held
    hypothesis is reported, as the tracker effectively does.
  - G4-range: central 0.85 (0.75–1.0).
  - G4-course: central 0.7 (0.55–0.9).

**P(carried to test) ≈ 40%**, limited by the speed control. P(G4 passes on test | carried) ≈ 80%.
