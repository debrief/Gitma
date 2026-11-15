---
title: "Re-tuning the classical trackers: the fused tracker's course falls short"
date: 2026-11-15
---

The severity sweep showed that the classical trackers we compared against had been tuned on white
noise, which flattered the fused tracker. So we re-tuned both of them, the IMM and the EKF, to the
realistic bearing error, then rebuilt the fused tracker on the re-tuned IMM and tried its 24
fusion settings again. To go to a gate, a setting had to beat both re-tuned trackers on G5's five
checks.

## What we found

- **Re-tuning helps the classical trackers a little.** Range error falls from 16.1% to 15.8% for
  the EKF and from 16.7% to 15.1% for the IMM. Both do it by treating the correlated error as
  heavier white noise.
- **The fused tracker's range advantage survives.** Its best setting has 12.5% range error:
  0.79 × the EKF's and 0.83 × the IMM's.
- **Its course after a manoeuvre does not.** Once the target has settled, the re-tuned EKF holds
  course to 8.3°; the best fused tracker manages 10.7°, 1.29 × the EKF and over the 1.1 limit.
  No setting comes close enough, so the phase stopped before the gate, as forecast.
- **Against the re-tuned IMM alone it would have passed validation.** Choosing the harder of the
  two references decided the outcome.

## What it means

The network improves range; the IMM it feeds still sets the course, and a plain EKF does that
better on settled legs. The fused tracker is a range aid, not a better tracker overall. One
condition of the project's qualified go, a fair re-tuned reference, is not met; the owner decides
what follows. Fusing the network's range into the EKF instead is the obvious untried design.

Results: `experiments/20261115-p14-val/validation.md`.
