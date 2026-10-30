# SRD Annex C: Phase 4, end-to-end learned trackers and gate G5

Oct 30, 2026 · @Ian Mayo · annex to [SRD.md](SRD.md)

## C.0 Status and scope

Phase 3 closed under Annex B §B.5's second branch. Phase 3 (`experiments/20261029-p3a-val/`) and
phase 3b (`experiments/20261030-p3b-val/`) stopped at validation. Their test seeds, 209 and 210,
were never scored.

On 2026-10-30 the owner decided (decision 28) to start the separate project that branch names:
**an end-to-end learned tracker**. It is built without the constant-velocity assumption and
trained on manoeuvring targets from the start.

It is a new phase, not a further phase-3 iteration:
- **It re-opens every gate it touches.** The generator changes, so G0 is re-run, and the
  references are re-tuned.
- **G5 is a new gate** (C.5).

Nothing in this annex is implemented until spec 012 is written against it. Where this annex and
the main body or the constitution disagree, the amendments in C.7 apply once this annex is
accepted.

## C.1 What phases 3 and 3b showed

- **After a turn, a network beats the tuned tracker.** Two different output designs each beat
  the tuned IMM five minutes after a turn: range ratio 0.76–0.77, course 0.60, gross errors
  6 points fewer. The lead holds whatever ownship does after the turn.
- **On a straight leg, it loses.**
  - Averaging "turned" and "not turned" (3a) cost course (11.1°) and speed (1.60 kt).
  - Reporting the more probable of two hypotheses (3b) fixed course (6.1°) but not speed
    (1.15 kt). The turn flag false-alarms on about 30% of held-course rows.
  - Even where 3b reports "held", its speed error is 1.00 kt, against the IMM's 0.71 kt and batch
    least squares' 0.31 kt. Over six iterations the network has stayed about 3 × classical on
    straight-leg speed.
- **The open question.** Can a learned tracker keep the filter's accuracy on straight legs and
  the network's after a manoeuvre, on a problem where manoeuvres are the norm?

## C.2 The problem change: generator 0.5.0

| Parameter | Phase 4 range | Notes |
| --- | --- | --- |
| Course changes | 0–3 per scenario: P(0, 1, 2, 3) = 0.2, 0.3, 0.3, 0.2 | Each 30–120°, sign uniform, rate-limited at 0.5–3°/s, as in 0.4.0 |
| Speed changes | One, in 30% of scenarios: ±2–6 kt at 0.05–0.2 kt/s | The speed stays within 3–20 kt; manoeuvres never overlap (amended 2026-10-30 while implementing: an overlap would make a step's kinematics ambiguous to check) |
| Timing | First manoeuvre starts ≥ 2 min after ownship's first turn ends. Manoeuvres are ≥ 3 min apart (end to start). The last ends ≥ 6 min before the window ends | Manoeuvres start only once the problem is observable, and each leaves time to score the response |
| Fit | A window that cannot fit its drawn manoeuvres is redrawn, as in 0.4.0 | The realised distribution (counts, window lengths, coverage at each gate time) is reported at G0, as the 0.4.0 panel required |
| Window | 20–60 min (amended 2026-10-30 while implementing, from phase 3's 10–40 min) | On 10–40 min windows three turns and a speed change rarely fit: 6 redraws per scenario, and only 12% reach zig + 20 min. On 20–60 min windows it is 0.4 redraws and 54% |
| Count | Drawn once per scenario before the geometry, and kept through redraws | So the realised count distribution is the declared one (redrawing the count with the geometry left 3.7% with three turns) |
| Everything else | As phase 3 (`configs/phase3-ranges.json`) | Two ownship zigs across the line of sight, 3–20 kt, 2–20 km, σ 0.5–2°, dropouts 0–10% |

**Metadata.** Each manoeuvre's start and end sample indices, its kind (course or speed) and its
size. `manoeuvre_index` (the end of the last manoeuvre) is kept, so phase-3 slices still work.

**G0 is re-run on 0.5.0** before any training, with an agent panel. It covers:
- known-answer tests for each manoeuvre kind;
- noise-free checks of the trackers between manoeuvres.

## C.3 The reference: re-tuned trackers

As Annex B §B.3: the IMM (CV + coordinated turn) and the single EKF are both re-tuned on the
phase-4 *validation* split. The better of the two is frozen as the reference before any model
is trained.

- **The tuning objective** changes with the gate: the median range error over all G5 rows (C.5),
  not at a single post-turn time.
- **A speed change** is handled by the CV model's process noise. A third, constant-acceleration
  model is added to the IMM's grid only if validation shows it helps. That choice is made and
  frozen before training.
- **Reported beside every result:** batch least squares (per timestep) and naive. These are
  expected to fail on manoeuvring rows and are reported to show it.

## C.4 The two trackers (owner decision: both, compared)

Both trackers are trained from scratch on the same phase-4 training seed, with the same budget
(up to three chained CI jobs each). Each is declared, with its full configuration, in the
decision record before training. Both are judged on the same rows.

**T1, a learned-gain filter** (KalmanNet-style, Revach et al. 2022):
- **The physics stay explicit.** A constant-velocity prediction and a bearings-only update, with
  the wrapped innovation.
- **A recurrent network computes the gain each step.** Its inputs are innovation and
  state-difference features, so it learns how quickly to adapt after a manoeuvre.
- **Training.** End to end through the filter recursion (backpropagation through time), on
  position and velocity error.
- **Initialisation.** It starts where the trackers do: from the batch solution at the end of
  ownship's first turn.

**T2, a pure recurrent tracker:**
- **Architecture.** The phase-3 LSTM family on the derived feature set.
- **Output.** Position and velocity at each timestep, with a per-output log-variance, trained by
  Gaussian negative log-likelihood. The uncertainty is reported and its calibration measured,
  but it is not gated.

**Expected weaknesses, stated in advance:**
- **T1:** backpropagation through about 300 filter steps in tfjs may be slow or unstable. The
  research step measures one epoch's cost before the decision record commits to it.
- **T2:** it inherits the network's straight-leg speed gap.

## C.5 Gate G5: better overall, no big loss when settled

**Rows.** The σ = 1° slice of a fresh test seed. Rows sit at zig + 5, 10, 15 and 20 min, where
the window reaches them, across all scenarios: manoeuvring or not, and whether the row falls
before, during or after a manoeuvre. Several rows come from one scenario, so every bootstrap
resamples **scenarios**, not rows (paired, 2,000 resamples, seed 20261011).

**Multiplicity.** Two trackers are judged, and G5 passes if either passes. Each tracker's
intervals are therefore **97.5%** (Bonferroni over two), so the chance of a false pass stays at
5%.

| Check | Statistic | Limit |
| --- | --- | --- |
| G5-range | median range error over all G5 rows, tracker / reference | wholly below 1 |
| G5-course | median course error over all G5 rows, tracker / reference | wholly below 1 |
| G5-speed | the same for speed | reported, not gated |
| G5-settled-range | median range error on *settled* rows, tracker / reference | wholly below 1.1 |
| G5-settled-course | the same for course | wholly below 1.1 |
| G5-settled-speed | the same for speed | wholly below 1.1 |
| G5-gross | gross-error rate (range error > 50% or no estimate), tracker − reference | reported, not gated |

**Settled rows** are G5 rows more than 5 min after the last manoeuvre ended, or in a scenario
with no manoeuvre. On those rows the constant-velocity model is right again, so they measure
straight-leg accuracy.

**The verdict.**
- **Pass** if all six gated checks pass for at least one tracker.
- **Fail** if, for each tracker, at least one gated check fails.
- **Inconclusive** otherwise. The FR-015 rule applies to each check. One re-score of the same
  frozen models on a larger fresh seed is allowed, as for G2 and G4; then the result is final.

**Validation rule.** A tracker is carried to the test split only if, on validation, every gated
check's point estimate meets its limit and no interval lies wholly beyond it. Both trackers,
one, or neither may be carried. If neither is carried, the test split is not scored.

**Why the bar is fair.**
- **The reference is favoured.** It is re-tuned for this problem and frozen at its best
  validation setting.
- **The overall checks reward manoeuvre accuracy without ignoring straight legs**, because
  settled rows are most rows.
- **The settled checks forbid phase 3's trade.** Winning after manoeuvres by losing on straight
  legs is not a pass. They allow a 10% margin, so a tracker within noise of the reference on
  straight legs is not failed for it.
- **The gate is still demanding on speed.** The IMM is already about 2 × least squares on
  straight-leg speed, and the network has not yet come within 1.4 × the IMM there.

## C.6 What follows G5

- **If G5 passes,** the follow-ons are incremental, as Annex B §B.5's first branch. Each is
  pre-registered under the Part B rules of Annex A:
  1. manoeuvre detection, judged against a CUSUM detector on the reference's innovations;
  2. calibration of the learned uncertainty;
  3. realistic bearing error (correlated, with slowly varying bias).
- **If G5 fails or is inconclusive after its re-score,** the owner decides the follow-on when the
  result is known (owner decision 2026-10-30, D4).
  - Unlike B.5, this is not fixed in advance, so the result may influence its own follow-on.
  - The decision and its reasons are recorded before any further work.
  - The write-up states that this branch was left open.

**Deferred either way:** real or recorded data (§1, §9).

## C.7 Amendments (apply when this annex is accepted)

**To the main body:**
- **§2:** from phase 4, the target may make up to three course changes and one speed change
  (C.2).
- **§3, parameter table:** the rows of C.2, applying from phase 4.
- **§4:** the learned-gain filter and the pure recurrent tracker are added as model variants for
  phase 4 (C.4).
- **§5, gates:** G5 (C.5) is added after G4.
- **§7:** a phase-4 row: "4 — Tracker | generator 0.5.0, G0 re-run, re-tuned references, two
  trackers | G5 | Not a stop; C.6".
- **§8, decisions taken:** decision 28.

**To the constitution, principle III (version 1.3.0, MINOR):** models may also contain a
**declared filter layer**. That is a fixed, documented recursion built only from standard tensor
operations: matrix products, elementwise maths, and `atan2` for bearings.
- **Portability.** Each filter layer is a Keras custom layer in principle. Its algorithm note
  states the equations exactly, so a port can implement and test it against the golden files.
- **Hyperparameters** still live in the manifest.
- **The pure recurrent tracker** still uses only the listed layers.

## C.8 Decisions

- **D1 The tracker design.** _Decided 2026-10-30: build both a learned-gain filter and a pure
  recurrent tracker, and judge them on the same gate (C.4)._
- **D2 The target motion.** _Decided 2026-10-30: 0–3 course changes and an occasional speed
  change, generator 0.5.0 (C.2)._
- **D3 The gate.** _Decided 2026-10-30: better overall than the re-tuned reference, with no more
  than a 10% loss on settled rows (C.5)._
- **D4 The follow-ons.** _Decided 2026-10-30: incremental if G5 passes; if it fails, decided
  when the result is known (C.6)._
- **D5 The reference.** Grids, the tuning, and the frozen reference go in the phase-4 decision
  record, before training.
- **D6 The trackers' configurations and seeds.** These also go in the decision record, before
  training. Fresh seeds run from 211; seeds 201–210 stay reserved.

## C.9 Order of work

1. **This annex** and the constitution amendment.
2. **Generator 0.5.0**, its schema change and slices; G0 re-run with an agent panel.
3. **Research.**
   - Re-tune the trackers on validation.
   - Build the learned-gain filter layer, with known-answer tests: with a fixed gain it must
     reproduce the EKF.
   - Build the probabilistic output head.
   - Measure each tracker's training cost.
   - Write `tma-g5`.
   - Commit the decision record.
4. **Training on CI**, both trackers.
5. **The validation diagnostic**, then G5 on the fresh test seed for each tracker carried.
6. **The agent panel**, `review.md`, and the write-up.
