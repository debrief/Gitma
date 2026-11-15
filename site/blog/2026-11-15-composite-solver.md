---
title: "A composite solver: the best of both, nearly — stopped at validation"
date: 2026-11-15
---

Spec 024 found that batch least squares reaches the information limit while the target sails
straight, and that the fused tracker is best once the target has manoeuvred. The obvious next
step was a **composite**:

- report least squares while its straight-line fit still explains the bearings;
- hand over to the fused tracker once the fit breaks.

## The test

- **The switch:** a residual check over the last W bearings against a threshold c. Once tripped,
  it latches. Nothing is trained.
- **The gate (G9):** better than the fused tracker overall on range and course, **and** within
  1.1 × of least squares on straight legs, under realistic bearing error.
- **Pre-registration.** W and c are picked on validation by a rule written down first. The
  composite goes to a fresh test set only if every check clears on validation.

## Result: no setting clears all five checks

The best setting (a 1-minute window, threshold 8) misses by 1.3% on overall course:

| Composite against                        | Range     | Course | Speed           |
| ---------------------------------------- | --------- | ------ | --------------- |
| The fused tracker, all rows              | **0.964** | 1.013  | 0.85 (reported) |
| Least squares, straight legs (limit 1.1) | 1.02      | 1.07   | 1.04            |

## Why

- **On straight legs it works.** It keeps least squares' accuracy, with course errors 4 × smaller
  than the fused tracker's.
- **After a manoeuvre it pays for being late.** Until the residual check trips, it keeps
  reporting least squares' out-of-date straight-line answer. Course there is 12% worse than the
  fused tracker's.
- **Most of the rows that count come after a manoeuvre,** so the late switch outweighs the
  straight-leg gain on course.
- **Tuning the threshold only trades one failure for the other.**
  - Switch earlier, and false alarms from the correlated error throw away least squares on
    straight legs.
  - Switch later, and the stale answers last longer.

This matches phase 5: detecting a manoeuvre from bearings alone is slow, whatever the detector.

## What it means

The composite is better than the fused tracker on range (about 4%) and clearly better on speed
(about 15%). It is not better on course, and the pre-registered rule asked for all three. No test
data were generated, and earlier results stand.

Possible next steps, each needing a new decision:

- a gate that judges straight legs and post-manoeuvre rows separately;
- a switch that can return to least squares on a new straight leg.

Record: `experiments/20261115-p12-val/` (grid, diagnostic, slices); SRD Annex D; spec 025.
