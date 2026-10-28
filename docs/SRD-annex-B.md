# SRD Annex B: Phase 3, manoeuvring targets and gate G4

Oct 28, 2026 · @Ian Mayo · annex to [SRD.md](SRD.md)

## B.0 Status and scope

All four gates of the main body are passed. G3 was passed by a hybrid (spec 009), not by a
network alone: the iteration-4 LSTM is still about 3 × the batch least-squares solver on speed,
and the hybrid's value is a lower gross-error rate where least squares lands far from the truth.

Every gate so far assumes a target that holds course and speed (§2, §3). That is the assumption
the classical estimator is built on, and the one place a learned estimator has an advantage in
principle is where it breaks. Phase 3 tests that. The owner set the bar on 2026-10-28 (decision
25): the outcome that counts as a success worth building on is **the network beating a tuned
EKF after a target manoeuvre**. Anything less is reported, and the follow-on in B.5 is chosen
accordingly.

Nothing in this annex is implemented until spec 010 is written against it. Where this annex and
the main body disagree, the amendments in B.6 apply once accepted.

## B.1 What G3 established, and what it did not

- **The network alone** passes G2 (0.939 kt speed error at zig + 10 min against 1 kt) but is
  2.1–3.5 × classical on every metric. Four iterations of model levers moved the gap from 2.4 ×
  to about 3 ×, never towards parity.
- **As a fallback** it halves classical's early gross errors (1.19% → 0.57% at zig + 5 min)
  without costing accuracy. The gain is in near-unobservable geometry and grows with noise
  (σ = 2°: 4.63% → 1.80%).
- **Not shown.** Anything about target manoeuvres, non-Gaussian or correlated bearing error,
  or real data. Batch least squares cannot track a turn at all, so it says nothing about the
  manoeuvring case either way.

## B.2 The problem change: a target manoeuvre

Generator 0.4.0 adds one target course change per scenario, so that both the physics-based
reference and the network have a settled solution to lose.

| Parameter | Phase 3 range | Notes |
| --- | --- | --- |
| Target manoeuvre | One course change of 30–120° (sign uniform) | Rate-limited at 0.5–3°/s, as ownship's turns |
| Manoeuvre time | Uniform in the window from 2 min after the end of ownship's first turn to 6 min before the window ends | So the target turns after the problem is observable and leaves time to score the response |
| Manoeuvre fraction | 80% of scenarios manoeuvre; 20% hold course | The straight 20% guard against a model that learns to expect a turn (B.4 control) |
| Target speed | Constant through the turn | A speed change is a later lever, not this phase |
| Everything else | As iteration 3 (`configs/iter4-ranges.json`) | Two ownship zigs across the line of sight, 3–20 kt, 2–20 km, σ 0.5–2°, dropouts 0–10% |

Metadata gains `manoeuvre_index` (the first sample after the target's turn completes; −1 when the
target holds course) and `manoeuvre_angle_rad`. The slicing keys gain the manoeuvre angle band
and "manoeuvred / held course".

G0 is re-run on the new generator before any training, as for every generator change.

## B.3 The reference: an extended Kalman filter

The main body (§4, §8) adds an EKF as a second reference once G3 is reached. Here it is the
primary reference, because batch least squares assumes constant velocity and cannot be the
comparator for a manoeuvre.

- **Model.** Constant-velocity state (x, y, vx, vy), bearings-only measurement, EKF update with
  the wrapped innovation. Initialised from the classical batch solution at the end of ownship's
  first turn (the point the problem becomes observable), then run per timestep.
- **Process noise.** Two settings, both reported and one gated:
  - **tuned-straight:** the process noise that minimises median range error at zig + 5 min on
    the held-course scenarios of the *validation* split;
  - **tuned-turn:** the process noise that minimises median range error 5 min after the
    manoeuvre on the manoeuvring scenarios of the *validation* split.

  Both are chosen on validation by a grid declared in the decision record, then frozen. The gated
  reference is **tuned-turn**: the setting most favourable to the EKF at the gate point. Both are
  reported beside every model figure, as is batch least squares (which is expected to fail after
  the turn, and is reported to show that).
- **Verified** as the batch solver was: on noise-free data it must track a manoeuvring target to
  within numerical precision once the turn has completed and the filter has re-converged, and
  its straight-target figures must agree with the batch solver's at zig + 10 min to within the
  bootstrap interval.

## B.4 Gate G4: better than the EKF after a turn

Judged on the σ = 1° slice of a fresh test seed, manoeuvring scenarios only, at
**manoeuvre + 5 min** (counted from `manoeuvre_index`, as gate times count from `zig_index`),
with paired bootstrap 95% intervals (2,000 resamples, seed 20261011) and the FR-015 rule.

| Check | Statistic | Limit |
| --- | --- | --- |
| G4-range | median range error, network / EKF (tuned-turn) | wholly below 1 |
| G4-course | median course error, network / EKF (tuned-turn) | wholly below 1 |
| G4-speed | median speed error, network / EKF (tuned-turn) | reported; not gated (speed does not change at the turn, so the EKF's prior helps it here) |
| G4-gross | gross-error rate, network − EKF (tuned-turn), at manoeuvre + 5 min | wholly at or below 0 |
| G4-control | the same network on the held-course scenarios, G2's three checks at zig + 5 and + 10 min | all pass (no regression from G2) |

- **Pass:** G4-range, G4-course and G4-gross pass, and G4-control passes.
- **Fail:** any of those fails.
- **Inconclusive** otherwise. One re-score on a larger fresh seed is allowed, as for G2 (§7);
  then it fails.
- **The network** is one carried instantaneous model, declared in the decision record before
  training, trained on the phase-3 data. The hybrid is reported beside it, never gated: the
  claim under test is the network's.
- **Not a stop condition.** G4 decides the follow-on (B.5).

**Why the bar is fair.** An EKF tuned for turns is noisier on straight legs; one tuned for
straight legs lags a turn for minutes. The gated reference gets the tuning most favourable to it
at the gate point. The network sees both regimes in training. If it cannot beat the EKF here, it
has no in-principle advantage anywhere on this problem.

## B.5 What follows G4

Decided by the owner on 2026-10-28, before phase 3 starts, so the result cannot choose its own
follow-on.

**If G4 passes** (the network beats the tuned EKF after a turn), the follow-ons are incremental,
each pre-registered under the Part B rules of Annex A, in this order:

1. **Manoeuvre detection as an output.** A per-timestep "target has turned" flag, judged by
   detection delay and false-alarm rate against a CUSUM detector on the EKF innovations.
   Detection is the hardest part of any tracking filter and is a cleaner operational claim than
   estimation.
2. **Learned uncertainty.** A per-estimate confidence interval, judged by calibration. It
   replaces the hybrid's fixed 50% switch with a principled one.
3. **Realistic bearing error.** Correlated error and a slowly varying bias, where both classical
   references' Gaussian assumption breaks.

**If G4 fails or is inconclusive after its re-score**, the follow-on is a decision rather than an
iteration:

- **Publish the negative result.** The record is clean: "a network of this design does not beat
  a tuned EKF on a single manoeuvre in simulation" is a finding worth having, and the write-up
  states what was and was not tried.
- **Then decide separately** whether an end-to-end learned tracker, built without the
  constant-velocity assumption and trained on manoeuvring targets from the start, is a new
  project. It is not run as a further iteration here: it re-opens every gate.

**Deferred either way.** Real or recorded data. That is a classification decision (§1, §9), not
a technical one.

## B.6 Amendments to the main body (apply when this annex is accepted)

- **§2:** "a single target that moves at constant course and speed" holds up to G3; from phase 3
  the target may make one course change (B.2).
- **§3, parameter table:** the rows of B.2, applying from phase 3.
- **§4 and §8:** "an EKF is added as a second reference only if G3 is reached": G3 is reached,
  and the EKF is added as B.3 describes, as the primary reference for G4.
- **§5, gates:** G4 (B.4) is added after G3, with the same FR-015 rule and the same one-re-score
  rule as G2.
- **§7:** a phase-3 row: "3 — Manoeuvre | generator 0.4.0, EKF reference, one carried model |
  G4 | Not a stop; B.5 decides the follow-on".
- **§8, decisions taken:** decision 25.

## B.7 Decisions the owner takes before spec 010 is written

- **D1** The success bar. _Decided 2026-10-28: the network beats the tuned EKF after a turn
  (B.4). Lesser outcomes are reported and route to B.5's second branch._
- **D2** The manoeuvre model: one course change, speed constant, 80% of scenarios. _Decided
  2026-10-28, as B.2._
- **D3** The gated reference: the EKF tuned on validation for the gate point (tuned-turn), with
  tuned-straight and batch least squares reported beside. _Decided 2026-10-28, as B.3._
- **D4** The follow-ons for each outcome. _Decided 2026-10-28, as B.5._
- **D5** The carried model and its fresh seed: in the phase-3 decision record, before training.
