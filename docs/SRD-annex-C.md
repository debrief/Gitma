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

**Settled rows** are G5 rows where the constant-velocity model is right again, so they measure
straight-leg accuracy (pinned 2026-10-30 after the G0 panel found the first wording ambiguous). At
row k:
- **No manoeuvre is in progress:** no span has start_index ≤ k < end_index.
- **Either no manoeuvre has started yet** (every start_index > k), **or the most recent one ended
  at least 5 min before:** (k − end_index) · dt ≥ 300 s, where end_index is the latest span end
  at or before k.

Later manoeuvres do not matter: a tracker cannot see them yet. On G0's data this is 44% of G5 rows.
The other reading, more than 5 min after the scenario's last manoeuvre, gives 27% and was not
meant.

**The verdict.**
- **Pass** if all five gated checks pass for at least one tracker.
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
- **D7 The reference initialisation.** _Decided 2026-11-05 (decision 32,
  `experiments/20261105-guarded-ref-decision/`): from decision 32 on, reference trackers use the
  guarded initialisation, level 1 (spec 016), with decision 29's tuning unchanged. The reference is
  `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`. Decisions 29–31 and their verdicts stand at level 0._

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

## C.10 Phase 4b: the tracker hybrid (owner decision 30, 2026-11-01)

Phase 4 stopped at validation (`experiments/20261031-p4-val/validation.md`). T2 beat the IMM
overall but lost on settled course and speed; T1 did not converge in range. Under C.6 the owner
chose the follow-on: a **hybrid** of the two frozen estimators, judged by **G5 unchanged**.

- **What is judged.** The hybrid of the frozen reference IMM and the frozen T2
  (`experiments/20261101-p4b-models`), reported as a hybrid, never as T2 alone. Nothing is trained.
- **The rule family** is declared here: the hybrid reports T2's range always, and T2's course and
  speed only where the two estimators' courses differ by more than θ; elsewhere the IMM's. It reads
  only the two estimators' outputs at the same row, so it is causal.
- **θ is chosen on seed-211 validation** by a criterion declared before the choice: the θ in
  {10, 15, …, 60, 90}° that maximises the smallest relative margin over the five gated checks
  (spec 013 R2). It is then frozen in the decision record.
- **The gate.** G5 exactly as in C.5: the same rows, checks, limits, bootstrap and 97.5% intervals
  (one estimator is judged, but the level is kept so that the gate is unchanged).
- **The test.** A fresh seed, 213 (400,000 scenarios; its 40,000-scenario test split, generated
  alone), committed in the decision before it is scored. The frozen models are bound by file
  digest (`model_digests`), since they were trained before this decision.
- **Re-score.** As C.5: one re-score on a larger fresh seed if the result is inconclusive.
- **Reported beside it.** T2 alone, the EKF, batch least squares and naive, on the same rows.
- **If it fails,** the owner decides the follow-on, as in C.6.
- **Known weaknesses, stated in advance.**
  - θ is chosen on the same validation split that showed T2's pattern, so the validation result
    is in-sample; only the fresh seed decides.
  - The hybrid's range is T2's alone, so the settled-range check rests entirely on T2 (0.97 × on
    validation, interval [0.92, 1.03]).
  - The IMM's velocity carries no stated uncertainty, so the hybrid's velocity sd is reported only
    where T2's velocity is used.

## C.11 Phase 4c: the fused tracker (owner decision 31, 2026-11-02)

Phase 4b's hybrid passed G5, but it reports range and velocity from different estimators. Before
any manoeuvre its range is 1.47 × the IMM's, and its settled velocity passes largely by copying the
IMM's (`experiments/20261101-p4h-g5/`). The owner chose to research a fused tracker on validation
first, then judge it.

- **What is judged.** The frozen reference IMM (decision 29), with the frozen T2's range fused in
  as a log-range measurement whose sd is T2's own stated log-range sd × k, applied every M samples
  after the bearing update. It is reported as a fused tracker, a filter combined with a frozen
  network, never as T2 alone. Nothing is trained.
- **k and M** were chosen on seed-211 validation (`experiments/20261102-fused-research/`), from a
  grid, as the middle of the region with the largest smallest G5 margin: **k = 4, M = 6**. (Corrected after decision 31, G5 panel round 1: the grid had 18 variants in two adaptive stages, not 12.) They
  are frozen in decision 31. The validation result is in-sample.
- **The gate.** G5 exactly as in C.5: the same rows, checks, limits, bootstrap and 97.5% intervals.
- **The test.** A fresh seed, 214 (400,000 scenarios; its 40,000-scenario test split, generated
  alone), committed in the decision before it is scored. T2 is bound by `model_digests`. The fused
  file is tied to T2's prediction file, and through it to T2's weights, by `tma-g5`'s prediction
  chain (schema 0.17.0).
- **Re-score.** As C.5: one re-score on a larger fresh seed if the result is inconclusive.
- **Reported beside it.** The phase-4b hybrid (θ = 45°), T2 alone, the EKF, batch least squares
  and naive, on the same rows. Also the settled rows before and after any manoeuvre, the NEES and
  the bearing-rate consistency.
- **If it fails,** the owner decides the follow-on, as in C.6. Phase 4b's pass stands either way.
- **Known weaknesses, stated in advance.**
  - k and M were chosen in-sample on the validation rows that also showed phase 4b's pattern.
  - On validation it is worse than the hybrid on overall course (0.93 × against 0.90 ×) and on
    range after a manoeuvre.
  - Its stated covariance is not calibrated, as the reference IMM's is not.
  - Against the EKF it is still worse on settled course (about 1.3 × on validation).

## C.12 Phase 5: manoeuvre detection, gate G6 (owner decisions 2026-11-05)

G5 passed (phases 4b and 4c), so C.6's first incremental follow-on applies: **manoeuvre detection,
judged against a CUSUM on the reference's innovations**. The owner chose, on 2026-11-05:
- **a detector built from frozen models, with no training;**
- **detection delay at matched false-alarm rates** as the gate.

The rest of this section was written by the implementing agent, and stands unless the owner
amends it before the decision record is committed.

- **The reference detector.** A CUSUM on the innovations of the decision-32 reference IMM
  (`imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`). There are two declared kinds:
  - on the normalised innovation squared (variance);
  - two-sided, on the signed normalised innovation ν/√S (mean shift).

  Each is clipped, so that one outlier cannot hold an alarm: on validation, 0.2% of quiet NIS
  values exceed 10. Its drift and clip are tuned on seed-211 validation from a declared grid. The
  best kind and setting is frozen, which favours the reference, as in C.3.
- **The learned detector.** It is built from the frozen T2 (`experiments/20261101-p4b-models`,
  bound by digest) and the reference IMM, with no training. There are two declared candidates:
  - T2's course disagreement with the IMM, |Δcourse|: the statistic the phase-4b hybrid switched
    on;
  - T2's own course change over the last 6 samples (1 min).

  The better on validation is carried.
- **Events.** Each target course change on a σ = 1° scenario whose start is a tracker row. The
  window runs 10 min from the start, cut at the next manoeuvre's start.
  - **Detection.** The event is detected at the first row in the window whose score is at or
    above the detector's threshold.
  - **The armed rule.** A detector already alarming on the row before the start is credited
    nothing.
  - **A miss** has delay +∞.
  - **Speed changes** are reported, not gated. Both learned candidates watch course only.
- **False alarms.** Alarm onsets on quiet rows, per hour. Quiet rows are G5's settled rows: no
  manoeuvre in progress, and none ended in the last 5 min.
- **Matched operating point.** Each detector's threshold is set on validation for **0.5 false
  alarms per hour** of quiet tracking (one per 2 h), and frozen in the decision record.
- **The gate, G6.** On a fresh test seed (215), with scenario-clustered paired bootstraps (2,000
  resamples, seed 20261011) and 95% intervals, since one detector is judged:

| Check | Statistic | Limit |
| --- | --- | --- |
| G6-delay | median detection delay, learned / CUSUM (misses +∞) | wholly below 1 |
| G6-detect5 | detected within 5 min, learned − CUSUM | lower bound ≥ −2 pp |
| G6-false-alarms | false alarms on quiet rows, learned / CUSUM, at the frozen thresholds | upper bound ≤ 1.25 |

  **Pass** if all three pass; **fail** if any fails; otherwise inconclusive. There is one
  re-score on a larger fresh seed, as C.5.
- **The bindings** are G5's, as tightened by spec 015:
  - a committed decision naming the seed, plans, detectors, thresholds and frozen models;
  - clean data at or after the decision;
  - the learned file's inputs given byte for byte, with T2's file naming the bound weights;
  - a re-computed 200-scenario sample of both detectors;
  - scored once, across experiments.
- **Reported beside it.** The CUSUM variants not carried, speed-change events, and all σ.
- **If G6 fails,** the owner decides the next step; C.6's items 2 and 3 remain.
- **The validation rule**, as C.5 and Annex A B.3 rule 3: the learned detector is carried to the
  test split only if, on validation, every check's point estimate meets its limit and no interval
  lies wholly beyond it.
- **Outcome (2026-11-05): phase 5 stopped at validation.** This is recorded in
  `experiments/20261105-p5-research/validation.md`.
  - **Result.** The best learned detector, T2's course change over 1 min, detects 19.2% of course
    changes within 5 min. The best CUSUM (mean shift) detects 28.2%: −8.95 pp [−10.16, −7.73]. It
    is not carried, and seed 215 was never generated.
  - **The delay check** is undefined at this operating point, since both detectors miss more than
    half the events.
  - **Reported only.** From about 1 false alarm per hour the learned detector catches more.
  - **Next.** The owner decides the follow-on.


## C.13 Phase 6: calibrated uncertainty, gate G7 (owner decisions 2026-11-06)

This is C.6's second incremental follow-on: **calibration of the learned uncertainty**. The owner
chose, on 2026-11-06:
- **to calibrate the fused tracker's uncertainty**, the tracker that passed G5 (C.11) and the one
  an operator would see;
- **to judge it as calibrated and sharper**: its intervals cover their nominal level, and they
  are narrower than the reference's after the same recalibration.

The rest of this section was written by the implementing agent, and stands unless the owner
amends it before the decision record is committed.

- **The trackers.** Both under decision 32 (`-g1`), writing stated sds (`-sd`, spec 018):
  - **carried:** `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd-k4-m6`, with T2
    bound by digest as in C.11;
  - **reference:** `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-sd`.

  Their estimates are unchanged by `-sd`.
- **Stated uncertainty.** For log-range, course and speed, taken from the tracker's combined
  covariance by the delta method.
- **Recalibration** (post hoc, no training, the same for both trackers). For each tracker and
  output, the q-interval is ± m_q × stated sd, where m_q is the q-quantile of |error / stated sd|
  over seed-211 validation's G5 rows (q = 0.5 and 0.9). The six multipliers per tracker are frozen
  in the decision record.
- **Rows.** G5's: σ = 1°, zig + 5, 10, 15 and 20 min. A row with no estimate is never covered,
  and its width is infinite.
- **The gate, G7.** On a fresh test seed (215), with scenario-clustered bootstraps (2,000
  resamples, seed 20261011) and 95% intervals, since one tracker is judged:

| Check | Statistic | Limit |
| --- | --- | --- |
| G7-coverage (six: three outputs × 50%, 90%) | share of the fused tracker's rows inside its calibrated interval | interval within nominal ± 2 pp |
| G7-width (three outputs) | median calibrated 90% width, fused / reference | wholly below 1 |

  **Pass** if all nine pass; **fail** if any fails; otherwise inconclusive. There is one re-score
  on a larger fresh seed, as C.5. The reference's coverage is reported.
- **The validation rule**, as C.5. Before any test data, a two-fold check runs on validation:
  multipliers fitted on even-indexed scenarios are judged on odd-indexed ones. The tracker is
  carried only if every check's point estimate meets its limit and no interval lies wholly
  beyond it.
- **The bindings** are G5's, as tightened by spec 015, plus the frozen `calibrations`.
- **If G7 fails,** the owner decides the next step; C.6 item 3 remains.
- **Outcome (2026-11-06): G7 on seed 215 is inconclusive** (agent panel rounds 1–2,
  `experiments/20261106-p6u-g7/`).
  - **The inconclusive check.** Log-range 50% coverage is 48.32% [47.81, 48.82], against a floor
    of 48%.
  - **The other eight gated checks pass.** The widths are 0.734 / 0.945 / 0.891 of the IMM's.
  - **Coverage is calibrated on the pooled row mix only.** Within regimes it is far off: fused
    log-range 50% is 67.2% on settled rows before any manoeuvre and 38.2% after one. 17% of course
    90% intervals are vacuous.
  - **The shortfall looks systematic**, about 3 SE, plausibly from reusing seed-211 validation.
  - **What may follow.** One re-score on a larger fresh seed is allowed. The owner decides whether
    to run it, and whether to keep the agent-written rules for it.
- **Outcome of the re-score (2026-11-07): G7 passes on seed 216** (decision 34, 110,000 test
  scenarios, the same rules and frozen multipliers; agent panel rounds 1–2,
  `experiments/20261106-p6v-g7/`). This is final.
  - **Coverage.** Log-range 50% is 48.62% [48.33, 48.91]. All nine gated checks pass.
  - **Widths.** 0.731 / 0.944 / 0.888 of the IMM's.
  - **What is claimed.** Pooled coverage within the ±2 pp tolerance and narrower intervals; not
    calibration. Log-range 50% is about 1.5 pp low on both seeds (pooled ~48.5%). Within regimes:
    66.7% on settled rows before any manoeuvre and 38.7% after one. 16.9% of course 90% intervals
    are vacuous, and 27% of speed 90% lower bounds are below 0.
  - **The false-pass risk** over the two looks is at most about 5%. The pass judges the frozen
    multipliers, not the procedure that fitted them.
  - **Next.** The owner decides the follow-on. Conditional calibration would be a new design.

## C.14 Phase 7: realistic bearing error, G5 rules (owner decisions 2026-11-08)

This is C.6's third incremental follow-on: **realistic bearing error**. On 2026-11-08 the owner
chose:
- **to test robustness with frozen trackers.** Nothing is trained, re-tuned or refitted. The
  question is whether the fused tracker's advantage over the reference survives bearing error
  that its components never saw.
- **the error model:** a first-order correlated (Gauss–Markov) term plus a slowly varying bias,
  added to the white noise, at one setting;
- **its severity** (on 2026-11-08, after the G0 panel noted that the agent's first numbers, 0.5° and
  0.3°, were its own and raised the total sd by only 16%): double them, to 1.0° and 0.5°. No
  tracker had been run on generator 0.6.0 data when either setting was chosen.
- **the pass rule:** G5's checks and limits, unchanged.

The rest of this section was written by the implementing agent. It stands unless the owner amends
it before the decision record is committed.

- **Generator 0.6.0** (schema 0.21.0 `BearingErrorModel`, `configs/phase7-ranges.json`). The
  phase-4 ranges plus a bearing error made of two terms:
  - a correlated term with sd 1.0° and τ 30 s;
  - a drifting bias with sd 0.5° and τ 20 min. Its correlation is 0.78 over a 5-min leg and 0.05
    across a 60-min window, so it is a drift within the window, not a constant offset.

  Each starts stationary and is drawn from the scenario's own stream, so the geometry and the
  white noise are 0.5.0's for the same seed. A noise-free scenario (σ = 0) has no bearing error,
  so G0's noise-free data are unchanged. At σ = 1° the total sd is 1.50°, 50% above the white noise alone.
- **G0 re-run on 0.6.0.** It adds the check `bearing-error-model`, on 1,000 regenerated σ = 1°
  scenarios:
  - the pooled residual sd matches the model within ±1%;
  - its mean is within 4 clustered standard errors of zero;
  - its correlations at 10 s, 30 s, 2 min, 10 min and 20 min each match the model within ±0.015.

  The largest deviations over 12 null seeds were 0.5% on the sd and 0.009 on a correlation. In a
  measured power study at 1,000 scenarios, a constant or 5-min bias, a bias sd off by 20%, an AR τ
  of 20 s, an AR sd off by 10%, or a missing term each failed it.

  `configs/phase7-heldout-ranges.json` exists only for G0's held-out split, which is generated but
  not gated. It plays no part in the gate. The tracker checks still
  test the filters' white-noise model, so they regenerate without the bearing error.
- **The trackers,** frozen, under decision 32 (`-g1`):
  - **carried:** `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`, with T2 bound
    by digest as in C.11;
  - **reference:** `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`.

  T2 keeps seed 211's normalisation constants: its features on new data are normalised with the
  constants it was trained on, from inputs only.
  - **How.** `scripts/train-plan.mjs data` regenerates seed 211 with the phase-4 ranges and computes
    `norm.json` from its train split.
  - **Accepted at generator 0.6.0.** Its header then says generator 0.6.0 where T2's
    `source_dataset_header` says 0.5.0. `tma-model-predict` accepts this only because 0.6.0
    without a bearing error is byte-identical to 0.5.0 (`EQUIVALENT_GENERATORS`). Any other version
    change, or ranges with a bearing error, is still refused.
- **The gate:** G5 unchanged (C.5): the same rows, five checks, limits, 97.5% intervals,
  clustered bootstrap, `tma-g5` and spec 015's bindings. It is scored on the 40,000-scenario test
  split of a 400,000-scenario fresh seed (218), generated with the phase-7 ranges. A plan's
  `fresh_test.ranges` names them, and seed 211 still supplies the training data and normalisation.
  The plan's digest check refuses a fresh split whose header does not record exactly those ranges.
  Seeds 217–219 are reserved from decision 35 on.
- **Validation first.** On seed 217's 10,000-scenario validation split with the phase-7 ranges,
  `tma-g5` runs as a diagnostic.
  - **Carried to the gate** if every point estimate is within its limit.
  - **Otherwise phase 7 stops at validation,** seed 218 is never generated, and the result is
    published.
- **Reported, not gated:**
  - the same rows of seeds 217 and 218 regenerated with the phase-4 ranges, so the geometry and
    white noise are identical and only the added error differs. Each tracker's degradation from
    clean to realistic is reported, as a paired ratio of medians;
  - the EKF (`-g1`);
  - settled rows before any manoeuvre and after one.
- **Re-score.** As C.5: one re-score if the result is inconclusive, fixed now. It uses seed 219,
  a 1,100,000-scenario dataset whose 110,000-scenario test split is generated with the phase-7
  ranges. One tracker is judged at 97.5% (G5's level, kept deliberately), so a false pass is at most
  about 2.5% per look, and at most about 5% over the gate and its re-score. These are upper bounds:
  each check is one-sided, at about 1.25%, and a pass needs all five.
- **The clean comparison** (reported, fixed now). On the same G5 rows of each scored seed (217, and
  218 only if carried), regenerated with the phase-4 ranges, `scripts/research/spec019-clean.mjs` reports:
  - each tracker's realistic/clean ratio of median range error and of median course error;
  - the interaction: (fused/IMM, realistic) ÷ (fused/IMM, clean).

  Each comes with a scenario-clustered bootstrap 95% interval (2,000 resamples, seed 20261011).
  It does not use `tma-g5`, which scores a decision and seed only once. The script is committed
  before seed 217's validation is scored.

  The phase-4-range regeneration of seed 218 shares the gate rows' geometry and white noise, so it
  would preview the gate. It is generated and scored only after the seed-218 G5 verdict is
  committed.
- **If it fails,** the owner decides the next step. Decisions 29–34 and their verdicts stand
  either way.
- **What a pass would show:** the advantage survives this one error model at this one severity.
  It would not show robustness to other models or severities, or to real data.
- **Outcome (2026-11-08): G5 passes on seed 218** (decision 35; agent panel rounds 1–2,
  `experiments/20261108-p7-g5/`). Fused/IMM: overall range 0.766 [0.755, 0.778] and course 0.907;
  settled range 0.774, course 0.875 and speed 0.907. Validation on seed 217 agreed.
  - **The advantage survives against a frozen reference.** It is not shown against an IMM adapted
    to correlated error.
  - **T2 alone has lower range error** than the fused tracker: 12.1% against 13.2%, fused/T2
    1.095 [1.080, 1.113]. It is also the most robust: realistic/clean 1.47 ×, against the IMM's
    1.82 × and the fused tracker's 1.68 ×. The fusion's frozen k plausibly gives it too little weight
    under this error (k was not re-swept).
  - **Classical methods remain better on straight legs.** The EKF wins on settled course (fused/EKF
    1.27 ×) and speed. Batch least squares before any manoeuvre: 7.3% range, 2.2° course.
  - **Not measured:** NIS, NEES and non-PD counts under correlated error.
  - **Every tracker degrades 1.5–2.1 ×.** The fused tracker's median range error is 13.2% and its
    course error 27°. The scope is one error model at one severity.
  - **Next.** The owner decides the follow-on. Re-tuning the fusion, or adding a bias state, would
    be a new decision on a new seed.

## C.15 Phase 8: the fusion re-tuned for correlated error, gate G8 (owner decisions 2026-11-10)

In phase 7 (C.14), under realistic bearing error, T2 alone had lower range error than the fused
tracker (fused/T2 1.095). The fusion's k and M were tuned on clean data and then frozen. On
2026-11-10 the owner chose:
- **to re-tune the fusion's k and M** on validation data with realistic bearing error. T2, the
  IMM's settings, the reference, the generator (0.6.0) and the error model
  (`configs/phase7-ranges.json`) stay frozen;
- **the gate: beat T2 alone on range and still pass G5** against the `-g1` IMM.

The rest of this section was written by the implementing agent. It stands unless the owner amends
it before the decision record is committed.

- **Tuning data.** Seed 217's 10,000-scenario validation split with the phase-7 ranges, the split
  phase 7 validated on. Validation was then scored only at k 4, M 6.
- **The grid.** 24 variants: k ∈ {0.5, 1, 1.5, 2, 3, 4} × M ∈ {1, 3, 6, 12} samples, each on the
  frozen `-g1` IMM, named `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k<k>-m<M>`.
  The fused tracker's tuning stays in its name, so spec 015's recomputation binds it.
- **The selection rule, fixed before any variant is scored.** Six point ratios of medians on the G5
  rows:
  - the five G5 checks against the IMM, with limits 1, 1, 1.1, 1.1 and 1.1;
  - fused/T2 median range error over all G5 rows, with limit 1.

  Each check's margin is (limit − point) / limit, and a variant's score is its smallest margin.
  The variant with the largest score is carried. A tie within 0.005 goes to the larger k, then
  the larger M (closer to the frozen setting).
- **Carry rule.** If the carried variant's score is above 0, it goes to the gate. Otherwise phase 8
  stops at validation, the result is published, and no test seed is generated.
- **The gate, G8.** On the 40,000-scenario test split of fresh seed 220 (400,000 scenarios,
  phase-7 ranges), with scenario-clustered bootstraps (2,000 resamples, seed 20261011) and 97.5%
  intervals, as G5:

| Check | Statistic | Limit |
| --- | --- | --- |
| G5's five gated checks | fused / `-g1` IMM, as C.5 | as C.5 |
| g8-range-vs-network | fused / T2 median range error, all G5 rows | wholly below 1 |

  - **Pass** if all six pass, **fail** if any fails, otherwise **inconclusive**.
  - **The re-score**, if inconclusive, is fixed now: seed 221, a 1,100,000-scenario dataset with
    a 110,000-scenario test split, phase-7 ranges. The same names, models and rules apply.
  - **False passes.** One tracker is judged at 97.5%, so a false pass is at most about 2.5% per
    look, and at most about 5% with the re-score.
  - **The bindings** are G5's (spec 015). T2 is bound by `model_digests`, and its file is the one
    in the prediction chain.
- **Reported, not gated.** Using `scripts/research/spec019-baselines.mjs` and `spec014-lsq.mjs`,
  as in phase 7:
  - fused/T2 on course, speed and settled rows;
  - the EKF, batch least squares and naive;
  - phase 7's frozen k 4, M 6 on the same rows.
- **Seeds** 220–221 are reserved from the decision record on; 217 stays reserved.
- **If G8 fails,** the owner decides. C.14's verdict stands either way.
- **What a pass would show:** a fusion weighting exists, tuned on validation with this one error
  model, under which the fused tracker beats T2 alone on range while still beating the IMM. It
  would not show robustness to other error models or severities, or that the gain holds on clean
  data.
- **Outcome (2026-11-10): phase 8 stopped at validation** (`experiments/20261110-p8-research/`).
  - **No variant clears the rule.** The best score is −0.014, at k 3, M 1, and the tie rule
    selects k 4, M 1 at −0.016. The binding check is always fused/T2 range.
  - **The fused tracker never beats T2 on range.** The best fused/T2 is 1.014. Weighting T2 more
    (k 0.5) still gives 1.027, and course collapses (settled course up to 1.27 × the IMM's).
  - **Re-tuning does improve the fused tracker against the IMM:** range 0.740 at k 3, M 1, against
    0.777 at the frozen setting.
  - **No G8 was scored.** Seed 220 was never generated, and seeds 220–221 stay unused. C.14's
    verdict stands.
  - **Next.** The owner decides. The remaining options are a bias state in the IMM, or reporting
    T2's range directly.


## C.16 Phase 9: an IMM with a bearing-bias state, gate G8 (owner decisions 2026-11-12)

Under realistic bearing error, T2 alone beats both the frozen IMM (C.14) and every fusion setting
(C.15) on range. On 2026-11-12 the owner chose to give the classical filter a model of the error:
- **an IMM with a drifting bearing-bias state**, tuned on validation with realistic error;
- **judged by G8's rules:** beat T2 alone on median range error, and pass G5 against the frozen
  `-g1` IMM.

The rest of this section was written by the implementing agent. It stands unless the owner amends
it before the decision record is committed.

- **The filter** (spec 021, opt-in, name suffix `-b<sd>-tb<τ>`): the `-g1` IMM with a sixth state,
  a Gauss–Markov bias b added to the predicted bearing. It is initialised at 0 with its stationary
  variance. The 5-state IMM is unchanged (byte-identical).
- **Tuning data:** seed 217's 10,000-scenario validation split with the phase-7 ranges, as C.15.
- **The grid.** 18 variants: bias sd ∈ {0.25°, 0.5°, 1°} × τ ∈ {600, 1200, 2400} s × the
  measurement-variance scale r ∈ {4, 8}. The other IMM settings are decision 29's.
- **The selection rule,** fixed before any variant is scored. As C.15, with six point ratios of
  medians on the G5 rows:
  - the five G5 checks against the frozen `-g1` IMM;
  - candidate/T2 median range over all G5 rows, with limit 1.

  A variant's score is its smallest margin, and the largest score is carried. A tie within 0.005
  goes to the smaller bias sd, then the larger r (closer to the frozen IMM).
- **Carry rule.** A score above 0 goes to the gate. Otherwise phase 9 stops at validation and no
  test seed is generated.
- **The gate, G8** (`tma-g5 --beat`, as C.15), on the 40,000-scenario test split of fresh seed 222
  (400,000 scenarios, phase-7 ranges).
  - **The re-score**, if needed: seed 223, 1,100,000 scenarios, a 110,000-scenario test split.
  - **Seeds 222–223** are reserved from the decision record on.
  - **False passes:** at most about 2.5% per look, at most about 5% with the re-score.
- **Reported, not gated:** the candidate against the fused tracker; the clean twin (phase-4 ranges)
  of seed 217's rows; the bias estimate's spread.
- **Forecast, before any validation scoring.** A constant bearing bias is nearly unobservable in
  these geometries. On 8 scenarios of seed 9, not the validation seed, a 1° offset left the batch
  least-squares residual unchanged in 6 of 8 (0.27°), because the geometry rotates to absorb it.
  In a smoke test on 300 scenarios of seed 5, also not the validation seed, the bias state moved
  median range error only from 19.2% to 18.9%. Phase 9 is therefore expected to stop at
  validation, and the owner chose to run it and record the result.
- **If G8 fails,** the owner decides. C.14's and C.15's results stand either way.
- **Outcome (2026-11-12): phase 9 stopped at validation, as forecast**
  (`experiments/20261112-p9-research/`).
  - **The best score is −0.368** (0.25°, 600 s, r 8); the tie rule selects 0.25°, 1,200 s, r 8.
    The binding check is always candidate/T2 range.
  - **At best the candidate equals the frozen IMM** (range 0.998, course 0.996) and stays
    1.37–1.53 × T2's range error. A larger bias sd or a smaller r is worse.
  - **The bias is nearly unobservable:** the geometry rotates to absorb it.
  - **Seeds.** Seed 222 was never generated; 222–223 stay reserved.
  - **Next.** The owner decides. C.14's and C.15's results stand.

