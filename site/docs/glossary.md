---
title: Glossary
---

TMA and ML terms as used in this project, alphabetical. Algorithm details are linked where they
exist.

**Bearing** — True direction from ownship to the target, clockwise from north, in radians in
[0, 2π). The only measurement the estimators receive about the target.

**Bearings-only TMA** — Estimating a target's position and velocity from a time series of bearings,
with ownship's own track known. See [least-squares solver](algorithms/least-squares-solver.md).

**Causal** — A model whose output at time _t_ uses only inputs up to _t_. The instantaneous variant
is causal.

**Classical baseline** — The batch least-squares bearings-only solver; the yardstick a model must
approach for G3. See [least-squares solver](algorithms/least-squares-solver.md).

**Dropout** — A missing bearing sample (`valid = false`). Drawn independently per sample.

**Gate** — A pass/fail decision at the end of an iteration (G0–G3), judged on fixed metrics. See
[evaluation](evaluation.md).

**Gross error** — A scenario whose range error exceeds 50%, or whose estimator did not converge.
Reported as a rate because TMA failures are heavy-tailed.

**Held-out geometry** — A test set drawn from parameter ranges outside training (for example
20–30 km initial range), used to measure extrapolation.

**Instantaneous variant** — The model that gives the operator's running solution: at each time,
range, course and speed from bearings so far. Scored as a curve of error against time since the zig.

**Leg** — A period of constant ownship course and speed. Every scenario has two legs.

**Naive baseline** — Predicts training-set means and ignores the bearings. Anything that cannot
beat it has learned nothing. See [naive baseline](algorithms/naive-baseline.md).

**Noise σ** — Standard deviation of the Gaussian error added to each bearing (0.5°, 1° or 2°).

**Observability** — Whether the bearings determine the target state. From a single straight leg
they do not determine range; the zig makes the problem observable. Small zigs and long ranges make
it weakly observable.

**Ownship** — The observing platform, whose track is known exactly.

**Scenario** — One ownship-versus-target run over a window: two tracks, the bearings and the
metadata that generated them. See the [data dictionary](data-dictionary).

**Time-late variant** — The model that reconstructs the target track after the fact, using the
whole window (non-causal). It has strictly more information than the instantaneous variant, so it
must score at least as well.

**Window** — The span of bearings a model sees: 10–40 minutes at one bearing every 10 s, padded to
240 rows.

**Zig** — Ownship's course change part-way through the window (30–90° at 40–60% of the window).
