---
title: "Iteration 0: G0 passes — the pipeline is verified"
date: 2026-10-11
---

The first gate asks a narrow question: can we trust the data before training anything on it?

**Verdict: G0 pass** (machine verdict; team review pending). Experiment:
`experiments/20261011-g0/`.

- 100,000 noise-free scenarios generated (seed 42); the 10,000-scenario test split was scored.
- The least-squares solver recovered truth on **10,000 / 10,000** scenarios. Worst cases: 2.9×10⁻⁴
  relative range, 0.016° course, 0.002 kt speed (tolerances 10⁻³, 0.1°, 0.01 kt). Median range
  error 1.9×10⁻⁷.
- The naive baseline reproduced exactly across two independent fits.

## Yardsticks for iteration 1

On the same noise-free test set, the naive baseline's median range error is 40% (P90 139%), its
median course error 90° and its gross-error rate 37%. Any model must beat these to pass G1.

On noisy data (σ 0.5–2°, up to 10% dropouts) the classical solver's median range error is about 5%,
with P90 ≈ 43% and gross-error rate ≈ 9%. None of those gross errors were optimiser failures:
starting from the true state never found a lower cost. The tail comes from the information in the
bearings, not from a weak solver.

## Caveat

Passing G0 shows that generator and solver agree. On its own it would not catch an error shared by
both; hand-computed geometry tests cover that separately.

Generation plus the G0 run took about 70 seconds on a laptop-class machine.
