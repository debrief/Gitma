---
title: "How the trackers cope as bearing error gets worse"
date: 2026-11-15
---

The project's "qualified go" for the fused tracker rested on one level of realistic bearing
error. We re-ran every frozen estimator on the same scenarios at four levels: no correlated error
(×0), half (×0.5), the usual level (×1) and double (×2).

## What we found

- **The fused tracker keeps its edge over the classical IMM** at every level: its range error is
  0.84, 0.79, 0.78 and 0.77 × the IMM's. The edge grows a little, then levels off.
- **Batch least squares stays at the information limit on straight legs** at every level. Nothing
  can do better there.
- **The network on its own overtakes the fused tracker as error grows.** At ×0 the fused tracker
  is better; at ×0.5 they tie; at ×2 the network alone has 20% less range error. The fused
  tracker inherits the IMM's weakness under heavy error, and its settings were chosen on white
  noise.
- **The composite solver's switch breaks under heavy error.** Correlated error looks like a
  manoeuvre to its fit check, so at ×2 it gives up least squares on straight legs.

## What it means

The qualified go survives. Two conditions get sharper: the fusion's settings, and the classical
reference it is judged against, both need tuning to the error level of real data. Part of the
network's robustness is a learned prior about typical geometry, which only helps while real
engagements look like the simulated ones.

Results: `experiments/20261115-p13-sweep/results.md`.
