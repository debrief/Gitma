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
EKF after a target manoeuvre**; the reference became a tuned IMM tracker the same day (B.3, D3),
the bar unchanged in intent. Anything less is reported, and the follow-on in B.5 is chosen
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

Metadata gains `manoeuvre_start_index` and `manoeuvre_index` (the first samples after the target's
turn starts and completes), and the parameters gain the turn's time, signed angle and rate; all are
absent when the target holds course (amended 2026-10-28 from "−1 / 0" while implementing: an
absent field cannot be mistaken for a sample index). The slicing keys gain the manoeuvre angle band
and "manoeuvred / held course".

G0 is re-run on the new generator before any training, as for every generator change.

## B.3 The reference: an IMM tracker (amended 2026-10-28)

The main body (§4, §8) adds an EKF as a second reference once G3 is reached. Here a tracking
filter is the primary reference, because batch least squares assumes constant velocity and cannot
be the comparator for a manoeuvre.

**Why not the single EKF first written here.** Spec 010's first tests found that a
constant-velocity EKF in Cartesian coordinates drifts after a target turn even on noise-free
bearings: its range error grows to about 50% and a later ownship zig does not correct it, for
every process-noise setting, while a batch fit on the post-turn bearings alone recovers the truth
exactly (Aidala's instability, 1979). Gating against it would make G4 a weak bar. The owner
re-decided D3 on 2026-10-28: the gated reference is an interacting-multiple-model tracker.

- **Model.** IMM (Blom and Bar-Shalom) of two EKFs on (x, y, vx, vy, ω): constant velocity with
  white-noise acceleration σ_cv, and coordinated turn with white-noise acceleration σ_ct and a
  turn-rate random walk σ_ω; Markov switching at `switch` per second. Bearings-only update with
  the wrapped innovation. Initialised from the classical batch solution at the end of ownship's
  first turn (the point the problem becomes observable), then run per timestep.
- **Tuning.** Two settings, both reported and one gated:
  - **tuned-straight:** the parameters that minimise median range error at zig + 5 min on the
    held-course scenarios of the *validation* split;
  - **tuned-turn:** the parameters that minimise median range error 5 min after the manoeuvre on
    the manoeuvring scenarios of the *validation* split.

  Both are chosen on validation from a grid declared in the decision record, then frozen. The
  gated reference is the **tuned-turn IMM**: the setting most favourable to the tracker at the
  gate point. Both are reported beside every model figure, as are the tuned single-model EKF and
  batch least squares (expected to fail after the turn, and reported to show that).
- **Verified** at G0 on noise-free data: every row from zig + 60 s to the target's turn within
  the SC-001 tolerances, and re-convergence to within 0.5% range after a target turn followed by
  an ownship zig. Re-convergence to numerical precision after *every* turn is not achievable: when
  the target turns after ownship's last zig, range is observable again only through the
  continuity of position, and no tracker recovers it exactly. G0 reports, without gating, the
  noise-free error at manoeuvre + 5 min on generated scenarios. The tuned IMM's straight-target
  figures are compared with the batch solver's at zig + 10 min in the phase-3 research (R2) and
  reported.

## B.4 Gate G4: better than the tuned tracker after a turn

Judged on the σ = 1° slice of a fresh test seed, manoeuvring scenarios only, at
**manoeuvre + 5 min** (counted from `manoeuvre_index`, as gate times count from `zig_index`),
with paired bootstrap 95% intervals (2,000 resamples, seed 20261011) and the FR-015 rule.

| Check | Statistic | Limit |
| --- | --- | --- |
| G4-range | median range error, network / IMM (tuned-turn) | wholly below 1 |
| G4-course | median course error, network / IMM (tuned-turn) | wholly below 1 |
| G4-speed | median speed error, network / IMM (tuned-turn) | reported; not gated (speed does not change at the turn, so the tracker's prior helps it here) |
| G4-gross | gross-error rate, network − IMM (tuned-turn), at manoeuvre + 5 min | wholly at or below 0 |
| G4-control | the same network on the held-course scenarios, G2's three checks at zig + 5 and + 10 min | all pass (no regression from G2) |

- **Pass:** G4-range, G4-course and G4-gross pass, and G4-control passes.
- **Fail:** any of those fails.
- **Inconclusive** otherwise. One re-score on a larger fresh seed is allowed, as for G2 (§7);
  then it fails.
- **The network** is one carried instantaneous model, declared in the decision record before
  training, trained on the phase-3 data. The hybrid is reported beside it, never gated: the
  claim under test is the network's.
- **Not a stop condition.** G4 decides the follow-on (B.5).

**Why the bar is fair.** A tracker tuned for turns is noisier on straight legs; one tuned for
straight legs lags a turn for minutes. The IMM switches between the two, and the gated reference
gets the tuning most favourable to it at the gate point. The network sees both regimes in
training. If it cannot beat the tracker here, it has no in-principle advantage anywhere on this
problem.

## B.5 What follows G4

Decided by the owner on 2026-10-28, before phase 3 starts, so the result cannot choose its own
follow-on.

**If G4 passes** (the network beats the tuned tracker after a turn), the follow-ons are incremental,
each pre-registered under the Part B rules of Annex A, in this order:

1. **Manoeuvre detection as an output.** A per-timestep "target has turned" flag, judged by
   detection delay and false-alarm rate against a CUSUM detector on the tracker innovations.
   Detection is the hardest part of any tracking filter and is a cleaner operational claim than
   estimation.
2. **Learned uncertainty.** A per-estimate confidence interval, judged by calibration. It
   replaces the hybrid's fixed 50% switch with a principled one.
3. **Realistic bearing error.** Correlated error and a slowly varying bias, where both classical
   references' Gaussian assumption breaks.

**If G4 fails or is inconclusive after its re-score**, the follow-on is a decision rather than an
iteration:

- **Publish the negative result.** The record is clean: "a network of this design does not beat
  a tuned IMM tracker on a single manoeuvre in simulation" is a finding worth having, and the write-up
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
  and a tracking filter is added as B.3 describes (the IMM, with a single EKF reported), as the
  primary reference for G4.
- **§5, gates:** G4 (B.4) is added after G3, with the same FR-015 rule and the same one-re-score
  rule as G2.
- **§7:** a phase-3 row: "3 — Manoeuvre | generator 0.4.0, IMM reference, one carried model |
  G4 | Not a stop; B.5 decides the follow-on".
- **§8, decisions taken:** decision 25.

## B.7 Decisions the owner takes before spec 010 is written

- **D1** The success bar. _Decided 2026-10-28: the network beats the tuned EKF after a turn
  (B.4); since D3's revision, the tuned IMM. Lesser outcomes are reported and route to B.5's second branch._
- **D2** The manoeuvre model: one course change, speed constant, 80% of scenarios. _Decided
  2026-10-28, as B.2._
- **D3** The gated reference. _Decided 2026-10-28 as a single EKF tuned on validation for the
  gate point; re-decided the same day, after spec 010's tests showed that EKF drifts after a turn,
  as the tuned-turn IMM, with tuned-straight, the tuned single EKF and batch least squares
  reported beside (B.3)._
- **D4** The follow-ons for each outcome. _Decided 2026-10-28, as B.5._
- **D5** The carried model and its fresh seed: in the phase-3 decision record, before training.
