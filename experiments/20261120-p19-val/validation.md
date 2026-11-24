# Phase 19 validation (spec 032, SRD Annex J): a time-late network against classical smoothers

**Data.** Seed 217's validation split (phase-7 ranges, realistic bearing error), regenerated at
a44cc6a7 with SHA-256 cdceee4f…, the value pinned in `run.sh` and phase 17's `inputs.sha256`.
16,711 G5 rows; 7,509 settled; 4,205 settled before any manoeuvre ("straight"). The thirteenth
selection on seed 217.

**Pre-registration.** Annex J, the smoothers, the smoother grid, the training plan
(`configs/phase19/a`, seed 244), the tuning and selection scripts and `run.sh` were committed in
05bc909 before training and tuning. The smoother tuning (`tune.json`, b82cff2) and the model
(`experiments/20261123-p19a-models/`, e146616) were committed before this run.

**The model.** `t2-tl`, a time-late Gaussian network (T2's architecture, `model_kind` time_late,
derived features), trained at 05bc909 on GitHub Actions over six dispatches: runner shutdowns cut
seven jobs, each resumed from the epoch checkpoint with Adam state. It stopped at the config's
48 h wall-clock cap after 49 epochs, not by early stopping; best epoch 46, validation loss −14.478
(−11.65 at epoch 10, −14.17 at epoch 30).

## Outcome

**Not carried.** The rule (Annex J §J.3) takes the candidate with the smallest margin as the
reference. That is Annex E's re-tuned forward EKF `ekf-sa0.03-p16-r64-g1`, margin **−1.695**,
from straight-leg course at 2.97 × its error. The network clears only one of the four candidates,
the IMM smoother.

| Check (limit) | EKF smoother | IMM smoother | Forward EKF | Forward IMM |
| --- | --- | --- | --- | --- |
| Overall range (1) | 0.58 | 0.65 | 0.73 | 0.76 |
| Overall course (1) | 0.76 | 0.63 | 0.48 | 0.59 |
| Settled range (1.1) | 0.68 | 0.76 | 0.82 | 0.83 |
| Settled course (1.1) | 1.01 | 0.74 | **1.52** | 1.08 |
| Settled speed (1.1) | 0.84 | 0.87 | **1.11** | 0.94 |
| Straight-leg course (1.1) | **1.29** | 0.81 | **2.97** | **1.23** |
| **Margin** | −0.171 | 0.206 | **−1.695** | −0.119 |

Point ratios of medians, network / candidate; bold fails its limit. Decision 47 was not committed;
seeds 245–246 were not generated and stay reserved.

## Medians on the G5 rows (`select.json`)

Range is relative error, course in degrees, speed in knots.

| Estimator | All: range / course / speed | Settled | Straight |
| --- | --- | --- | --- |
| **Time-late network** `t2-tl` | 0.115 / 16.9 / 2.18 | 0.112 / 12.6 / 1.98 | 0.097 / 9.2 / 1.73 |
| EKF smoother `ekfs-sa0.1-p16-r128-g1` | 0.199 / 22.3 / 2.97 | 0.165 / 12.5 / 2.35 | 0.129 / 7.1 / 1.79 |
| IMM smoother `imms-…-p32-r128-g1` | 0.178 / 26.7 / 2.90 | 0.147 / 16.9 / 2.26 | 0.110 / 11.3 / 1.65 |
| Forward EKF `ekf-sa0.03-p16-r64-g1` | 0.158 / 35.2 / 2.31 | 0.136 / 8.3 / 1.78 | 0.087 / 3.1 / 1.08 |
| Forward IMM `imm-cv0-…-p32-r64-g1` | 0.151 / 28.6 / 2.54 | 0.134 / 11.7 / 2.10 | 0.099 / 7.5 / 1.43 |
| Real-time T2 `lstm-gaussian` | 0.122 / 25.1 / 2.87 | 0.119 / 17.7 / 2.64 | 0.104 / 15.4 / 2.42 |
| Phase 15 fused EKF | 0.125 / 28.1 / 2.10 | 0.118 / 9.0 / 1.83 | 0.101 / 5.0 / 1.44 |
| Batch least squares (classical) | 0.173 / 46.3 / 2.44 | 0.133 / 7.1 / 1.71 | 0.069 / 2.0 / 0.83 |
| Naive `data/p4/naive-model.json` | 0.387 / 88.3 / 3.92 | 0.395 / 88.4 / 4.10 | 0.398 / 86.5 / 4.20 |

The naive row was scored after the selection, on the same rows (`pred/naive.ndjson`, digest in
`inputs.sha256`); it is not part of the rule.

## Critical analysis

- **What the network does well.** It has the lowest overall range and course of any estimator
  here: 0.67 × least squares on range and 0.36 × on course. Against the real-time T2, the window
  helps every slice: course 0.67 × overall and 0.60 × on straight legs, speed 0.76 ×. Seeing the
  bearings after a turn removes most of T2's lag after manoeuvres.
- **Where it fails.** On straight legs, least squares reaches the information bound (spec 024).
  The network's straight-leg course is 9.2° against least squares' 2.0° (4.6 ×) and the forward
  EKF's 3.1° (3.0 ×); its straight-leg range is 1.4 × least squares'. The time-late window did not
  close the straight-leg gap that stopped every real-time design. Annex J's forecast (pass about
  25%) named this check and the forward EKF as the obstacle.
- **The smoothers are weak references, and that did not decide the outcome.** Both tuned smoothers
  are worse on range than the forward filters, and the EKF smoother is worse on straight-leg course
  (7.1° against 3.1°). They were tuned on range alone (Annex J §J.2), so the tuning chose large σa
  and R. Both winners sit on the grid's upper R edge, which `tune.json` records as a limit. A better
  tuned smoother could only lower the margin further; the forward EKF, a pre-registered candidate,
  already sets it. The verdict does not depend on the smoother tuning.
- **Training stopped at the cap, not at convergence.** Validation loss was still falling about 0.1
  per five epochs. A 3 × straight-leg course gap is unlikely to close that way: from epoch 30 to 46
  the loss moved 2%. This is a single training run.
- **Many looks.** This is the thirteenth selection on seed 217. Nothing was tuned on it except the
  smoothers' grid, and the outcome is a stop.
- **What was not tried.** A composite that reports least squares or the forward EKF on straight
  legs and the network elsewhere would score well on these medians. Annex D tried that in real
  time and stopped on detection lag. Offline, a time-late segmenter could see the whole window,
  but that is a new design, not this annex.

## Reproduce

`bash experiments/20261120-p19-val/run.sh experiments/20261123-p19a-models/models/tracker` at a
clean commit, with seed 217's validation split in `data/p17val` (SHA above) and its seed-211
features; prediction digests in `inputs.sha256`.
