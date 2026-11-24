# SRD Annex J: a time-late network against classical smoothers

Nov 20, 2026 · annex to [SRD.md](SRD.md)

## J.0 Status and scope

The SRD's first question had two consumers: an instantaneous model (the solution now) and a
time-late model (the track over the window, §1). Time-late models were trained only in iterations
1–4. At G2's re-score the BiLSTM's speed error was 0.74 kt against the instantaneous LSTM's 0.94 kt;
both were about 3 × classical least squares. From phase 3 every gate judged real-time trackers, so
no time-late model was carried forward, and every annex since has met the same limit: telling a
manoeuvre from correlated bearing error in real time. A time-late model sees the bearings after a
possible turn.

The owner's decisions (2026-11-20):

- **J1:** train a time-late network and judge it against classical time-late methods.
- **J2:** build both classical smoothers, an EKF RTS smoother and an IMM smoother; the gate is
  against the harder one.

Earlier decisions stand: realistic bearing error, a fresh test seed and a review panel. The rest
of this annex was written by the implementing agent. It stands unless the owner amends it before
decision 47 is committed.

## J.1 The classical smoothers

- **EKF RTS** (`ekfSmooth`, `tma-track --filter ekf-smooth`, `ekfs-…`): the EKF's forward pass, then
  a Rauch–Tung–Striebel backward pass over each run of plausible states.
- **IMM smoother** (`immSmooth`, `--filter imm-smooth`, `imms-…`): the IMM's forward pass,
  recording each model's mixed prior and prediction; backward, an exact RTS step per model through
  that recursion, combined by Kim's smoothed model probabilities. Without switching it is each
  model's RTS smoother.
- Both re-computed from their names by the gates (spec 015). Tests: each beats its forward filter
  on turn-free tracks under white noise, and ends at it.
- **A design finding, stated before tuning.** On the seed-235 probe, smoothing with the forward
  filters' settings hurt on rows where a turn comes later in the window (a constant-velocity
  smoother drags the straight leg toward the post-turn bearings), and the drifting bias does not
  average out. The smoothers are therefore tuned for smoothing (§J.2).

## J.2 The time-late network and the tuning

- **Network.** T2's architecture, Gaussian head and settings as a time-late model
  (`configs/phase19/a/tracker.json`, `t2-tl`, `model_kind` time_late: two bidirectional 128-unit
  LSTM layers; train seed 1903), trained on fresh seed 244 (100,000 scenarios, phase-7 ranges,
  pinned digests).
- **Smoother tuning** on seed 217's validation split (the thirteenth selection on it;
  `configs/phase19/smoother-grid.json`, `scripts/research/spec032-tune.mjs`), by decision 29's
  objective, median range error over the G5 rows:
  - EKF RTS: σa ∈ {0.003, 0.01, 0.03, 0.1, 0.3} × R ∈ {16, 32, 64, 128} (P0 × 16): 20 settings;
  - IMM smoother: σcv ∈ {0, 0.003, 0.01} × σct ∈ {0.03, 0.1, 0.3} × σω ∈ {0.003, 0.01, 0.03} ×
    switch ∈ {0.0003, 0.001, 0.003} × R ∈ {32, 64, 128} (P0 × 32): 243 settings on 400 scenarios,
    the best 12 on all;
  - ties within 0.0005 to the larger R, then the smaller process noise.

## J.3 The reference and the carry rule

- **Candidates.** The tuned EKF smoother, the tuned IMM smoother, and Annex E's re-tuned forward EKF
  and IMM. A time-late analyst can always use a forward filter, so the forward trackers are
  candidates too; this only makes the gate harder than J2 asks.
- **The checks** (`scripts/research/spec032-select.mjs`), the time-late network against each
  candidate on the G5 rows: overall range and course (limit 1); settled range, course and speed
  (limit 1.1); straight-leg course, settled rows before any manoeuvre (limit 1.1; Annex G's G2).
- **The rule.** The gate's reference is the candidate with the smallest margin (ties: the order
  above). The network is carried if that margin is above 0.
- **Reported:** the real-time T2, phase 15's fused EKF tracker, batch least squares.

## J.4 The gate

`tma-g5 --straight-leg` (decision field `straight_leg_check`) with the time-late network as the
tracker and the chosen reference: six gated checks at 97.5%, scenario-clustered, FR-015 verdict,
spec 015 bindings. Fresh seed 245 (400,000; a 40,000-scenario test split, phase-7 ranges); one
re-score on seed 246 (1,100,000; 110,000). Decision 47. A five-reviewer panel.

## J.5 Forecast, stated before training and tuning

A pass is unlikely (about 25%). For: the time-late BiLSTM was the better learned model at G2, and it
sees the bearings after each turn. Against: on straight legs least squares and the EKF reach the
information bound, so straight-leg course against the forward EKF (3.1° on validation) is hard;
and the network's range errors are correlated in time, which smoothing does not remove.

## J.6 What follows

- **Pass:** a learned time-late reconstruction beats every tuned classical method; the project's
  answer gains a time-late "go".
- **Stop or fail:** time-late reconstruction joins real-time tracking: the network's range is the
  gain, classical methods hold the straight legs. The owner decides.

## J.7 Outcome (2026-11-24)

**Stopped at validation** (`experiments/20261120-p19-val/validation.md`). The time-late network
(`experiments/20261123-p19a-models/`, 49 epochs, stopped at the 48 h cap) has the lowest overall
range and course of any estimator on seed 217's G5 rows: 0.73 × and 0.48 × the forward EKF's, and
0.67 × the real-time T2's course. It clears the IMM smoother (margin 0.206) but not the other three
candidates. The reference is the forward EKF (margin −1.695): on straight legs its course is
2.97 × the EKF's (9.2° against 3.1°; least squares 2.0°), and settled course 1.52 ×. Both tuned
smoothers were weaker than the forward filters; the forward EKF, not the smoother tuning, set the
verdict. Seeds 245–246 were not generated and stay reserved; decision 47 was not committed.
