# Spec 026: bearing-error severity sweep

**Requirements:** SRD §1 (the project's answer), the go/no-go report's condition on representative
data; specs 019 (the error model) and 024 (bounds). This is research only: no gate, no training,
and validation data only.

## Goal

The project's qualified go rests on one error model at one severity. This spec maps how each
frozen estimator's accuracy changes with severity, to show where the fused tracker's advantage
holds, grows, shrinks or crosses over.

## Method

- **Data.** Seed 217's validation split, at four severities. Both realistic-error terms
  (Gauss–Markov 1.0°/30 s and drifting bias 0.5°/20 min) are scaled together:
  - **×0:** white noise only, the phase-4 ranges (the clean twin);
  - **×0.5** and **×2:** `configs/phase7-x0.5-ranges.json` and `configs/phase7-x2-ranges.json`;
  - **×1:** the phase-7 ranges.

  The geometry and white noise are the same at every severity.
- **Estimators, all frozen:**
  - the `-g1` IMM and EKF;
  - T2, with seed 211's normalisation;
  - the fused tracker;
  - batch least squares at every timestep;
  - naive;
  - Annex D's first composite (W 6, c 8).
- **Reported.** At each severity, on G5's rows:
  - medians of range, course and speed;
  - those medians on straight-leg rows (settled, before any manoeuvre) and on settled rows after a
    manoeuvre;
  - each estimator's range relative to the IMM's;
  - the Cramér–Rao bound (spec 024): exact on straight legs, a genie bound after a manoeuvre.

## Questions, fixed before the run

1. Does the fused tracker's range advantage over the IMM hold at every severity, and does it
   grow with severity?
2. Does least squares stay at the bound on straight legs at every severity?
3. At which severity, if any, does T2 alone overtake the fused tracker on range?

## Limits

- One error model family, scaled, rather than different shapes.
- One seed, validation only, with no intervals.
- The estimators were tuned at ×0 (the trackers) or trained at ×0 (T2), so higher severities test
  robustness, not retuning.

## Deliverables

- `experiments/20261115-p13-sweep/`: `run.sh`, the per-severity baselines and bounds,
  `sweep.json`, `inputs.sha256` and `results.md`.
- `scripts/research/spec026-sweep.mjs`.
- A results section on the go/no-go report, and a blog post.

## Outcome (2026-11-15)

`experiments/20261115-p13-sweep/results.md`. (1) The fused tracker's range advantage over the IMM
holds at every severity (0.84, 0.79, 0.78, 0.77 ×) and levels off above ×0.5. (2) Least squares
stays within 3% of the bound on straight legs at every severity. (3) T2 alone ties the fused
tracker at ×0.5 and beats it from ×1 (0.95 ×; 0.80 × at ×2).
