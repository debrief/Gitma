---
title: "Fading the network on straight legs: the trade-off holds"
date: 2026-11-18
---

The EKF fed with the network's range passed its gate overall, but on a target's straight leg it
was worse than the plain EKF. We tried two fixes together: let the network's weight fade once the
bearings fix range, and let the filter's process noise rise only when the bearings look surprising
(after a manoeuvre). A setting had to stay ahead overall and come within 10% of the EKF on straight
legs. None did, so the phase stopped before using a fresh test set.

## What we found

- **Adapting the process noise just moves the trade-off.** If it reacts readily, overall course
  recovers but straight-leg course gets worse; if it reacts rarely, the reverse. Under correlated
  bearing error, "surprising bearings" do not reliably mean a manoeuvre.
- **The fade does what it says, at a price.** It brings straight-leg course from 4.0° to 3.6° (the
  EKF manages 3.1°) but gives up the network's range overall: 13.9% error instead of 12.5%.
- **Even with the reference's own process noise, adding the network costs about 20% on straight-leg
  course.** Its range errors are correlated in time and leak into the velocity estimate.

## What it means

Straight legs belong to the classical methods (the EKF, and least squares even more so); the
network's range helps after manoeuvres and overall. The phase-15 tracker stays the best compromise
found. Splitting the work explicitly, a classical solution on straight legs and the fused tracker
after manoeuvres, is what the composite solver tried earlier; its weak point was detecting the
manoeuvre, the same weakness seen here.

Results: `experiments/20261118-p16-val/validation.md`.
