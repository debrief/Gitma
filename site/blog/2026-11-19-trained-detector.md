---
title: "A trained manoeuvre detector: no better than the classical one"
date: 2026-11-19
---

Three of our designs stumbled on the same question: has the target just turned, or is the bearing
error playing tricks? So we trained a network for exactly that question, on data with the realistic
bearing error, and compared it with the best classical change detector (a CUSUM on a tracker's
innovations) tuned to the same error.

## What we found

- **Every detector is weak when false alarms must be rare.** Allowing one false alarm every two
  hours on quiet stretches, the best CUSUM spots only 12% of turns within 5 minutes. Under clean,
  uncorrelated error the figure was 28%.
- **The trained network did not beat it**: 11% within 5 minutes, and slower on the turns both
  caught. It was no better than simply watching the tracking network's own course estimate (11%).
- **With more false alarms allowed the learned signals edge ahead.** At two false alarms an hour
  they catch about 35% against the CUSUM's 33%. That is not the operating point we committed to.

## What it means

Correlated bearing error makes quiet legs look like gentle turns, and that, not the choice of
detector, is the limit. This is why the composite solver and adaptive process noise failed, and a
trained detector does not remove it. Training choices (rewarding early alarms rather than sustained
ones, for instance) could still help, but nothing here suggests a large gain.

Results: `experiments/20261118-p17-val/validation.md`.
