---
title: Glossary
---

TMA and ML terms as used in this project, alphabetical. Algorithm details are linked where they
exist.

**Across the line of sight** — A zig that puts the target on ownship's other bow, judged from the
bearing at the start of the turn. It reverses ownship's velocity component across the line of
sight, the change bearings respond to most. It is iteration 3's rule for both turns (`zig_rule: across_los`; see
[generator](algorithms/generator.md)).

**Bearing** — True direction from ownship to the target, clockwise from north, in radians in
[0, 2π). The only measurement the estimators receive about the target.

**Bearing-line intercept** — c = x_o cos b − y_o sin b for ownship at (x_o, y_o) and bearing b: every
point (x, y) on the line of bearing satisfies x cos b − y sin b = c. A derived input channel (in km,
scaled). See [feature layout](algorithms/feature-layout.md#derived-feature-set).

**Bearing rate** — How fast the bearing changes (rad/s). The derived feature set estimates it at
each row as the least-squares slope of the bearings in the trailing 3 min (≥ 3 valid samples),
using no later samples. See [feature layout](algorithms/feature-layout.md#derived-feature-set).

**Bearings-only TMA** — Estimating a target's position and velocity from a time series of bearings,
with ownship's own track known. See [least-squares solver](algorithms/least-squares-solver.md).

**Causal** — A model whose output at time _t_ uses only inputs up to _t_. The instantaneous variant
is causal.

**Classical baseline** — The batch least-squares bearings-only solver; the yardstick a model must
approach for G3. See [least-squares solver](algorithms/least-squares-solver.md).

**Confidence interval (CI)** — The range a metric would plausibly take on another test set of the
same size. Here a percentile bootstrap: the test scenarios are resampled with replacement 2,000
times (seeded), and the 2.5th and 97.5th percentiles of the recomputed median are reported. Ratio
intervals (model/naive) resample both estimators' scenarios together (paired). See
[evaluation](evaluation.md).

**Cramér–Rao bound** — The smallest variance any unbiased estimator can achieve from given
measurements and noise. For a constant-velocity target it says how well the bearings themselves
pin down range, course and speed. At G2 the classical solver's speed error (0.62 kt) is at it.

**Control model** — A deliberately simpler model trained on the same data as a sequence model
(a causal CNN for the instantaneous LSTM, an MLP for the BiLSTM). If the sequence model cannot
beat its control, its result says little about learning the geometry. See
[models](algorithms/models.md).

**Dropout** — A missing bearing sample (`valid = false`). Drawn independently per sample.

**Early stopping** — Ending training when validation loss has not improved for `patience` epochs;
the best epoch's weights are kept.

**Gate** — A pass/fail decision at the end of an iteration (G0–G3), judged on fixed metrics. See
[evaluation](evaluation.md).

**Gross error** — A scenario whose range error exceeds 50%, or whose estimator did not converge.
Reported as a rate because TMA failures are heavy-tailed.

**Held-out geometry** — A test set drawn from parameter ranges outside training (for example
20–30 km initial range), used to measure extrapolation.

**Inconclusive** — A gate check whose 95% interval contains its threshold: the data cannot say
which side the true value is on. A gate with an inconclusive check, and no failing one, is
inconclusive; the agent review panel decides it under a pre-registered rule.

**Instantaneous variant** — The model that gives the operator's running solution: at each time,
range, course and speed from bearings so far. Scored as a curve of error against time since the zig.

**Leg** — A period of constant ownship course and speed. Scenarios have two legs (joined by a
rate-limited turn from iteration 2), or three from iteration 3 (a second zig).

**Naive baseline** — Predicts training-set means and ignores the bearings. Anything that cannot
beat it has learned nothing. See [naive baseline](algorithms/naive-baseline.md).

**Noise σ** — Standard deviation of the Gaussian error added to each bearing (0.5°, 1° or 2°).

**Observability** — Whether the bearings determine the target state. From a single straight leg
they do not determine range; the zig makes the problem observable. Small zigs and long ranges make
it weakly observable.

**Ownship** — The observing platform, whose track is known exactly.

**Provenance** — The record of what produced a file: a dataset header names the commit of the
generator code and whether the working tree was dirty; features files carry that header forward,
and training refuses data whose provenance is missing, dirty or from a generator other than the one
G0 verified. See [generator](algorithms/generator.md#provenance).

**Pseudo-linear measurement** — A bearing rewritten as an equation linear in the target's
position: x cos b − y sin b = x_o cos b − y_o sin b. With constant target velocity, each bearing
gives one linear equation in the target's initial position and velocity, the basis of
pseudo-linear TMA estimators and of the bearing-line intercept channel.

**Rate-limited turn** — Ownship's zig flown as a constant-rate turn at constant speed (iteration 2:
0.5–3°/s, so 90° takes 30–180 s) instead of an instantaneous course change. `zig_index` is the
first sample after the turn completes. See [generator](algorithms/generator.md#rate-limited-turn-iteration-2).

**Scenario** — One ownship-versus-target run over a window: two tracks, the bearings and the
metadata that generated them. See the [data dictionary](data-dictionary).

**Shuffled-label test** — A leakage check: the instantaneous model trained with each scenario's
targets swapped for another's. It should do no better than the naive baseline; if it does, the
inputs leak the answer.

**Time-late variant** — The model that reconstructs the target track after the fact, using the
whole window (non-causal). It has strictly more information than the instantaneous variant, so it
must score at least as well.

**Velocity outputs** — A model output parameterisation (iteration 4): the network predicts the
target's east and north velocity, scaled by the top of the target speed range, and course and
speed are derived from them. Earlier models predicted course as sine and cosine and speed on its
own. See [models](algorithms/models.md).

**Window** — The span of bearings a model sees: 10–40 minutes at one bearing every 10 s, padded to
240 rows.

**Zig** — Ownship's course change part-way through the window (30–90° at 40–60% of the window;
instantaneous in iterations 0–1, a rate-limited turn from iteration 2). Iteration 3 adds a second
zig 3–5 minutes into leg 2, and both turns are across the line of sight.
