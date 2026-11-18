# SRD Annex G: a fading range weight and adaptive process noise

Nov 18, 2026 · annex to [SRD.md](SRD.md)

## G.0 Status and scope

Annex F's EKF-fused tracker passed G5 against the re-tuned EKF (§F.6), but on settled rows before
any manoeuvre it was worse than that EKF: course 1.57 ×, range 1.10 ×, worse still late in a leg and
at close range. Two causes were found by the panel: T2's correlated range error keeps pulling the
filter once the bearings fix range, and the higher process noise (σa 0.07) costs course on a
straight leg (a plain σa-0.07 EKF is already 1.49 ×).

The owner's decisions (2026-11-17/18):

- **G1, the fade:** T2's weight falls as the filter's own range uncertainty falls.
- **G2, the gate:** G5 unchanged, plus a gated straight-leg check: course on settled rows before
  any manoeuvre within 1.1 × the reference's.
- **G3, the dynamics:** add adaptive process noise, so σa is low on straight legs and rises after
  a manoeuvre.

Unchanged by earlier owner decisions (E2, E3): a fresh seed, a review panel, and the harder of the
two re-tuned references. The rest of this annex was written by the implementing agent. It stands
unless the owner amends it before decision 44 is committed.

## G.1 The design

`fusedEkfPredict` with two additions (`tma-fuse-track --filter ekf … --fade c --adapt-hi a
--adapt-eta e`; names end `-f<c>-a<a>-e<e>`):

- **The fade.** At a scheduled range update, with the filter's own log-range sd
  σ_f = sqrt(H P Hᵀ) and the network's s = k · sd: if σ_f < c · s, the network's sd becomes
  s · c · s / σ_f. Its weight falls as the filter's range firms up; c = 0 is Annex F's fusion.
- **Adaptive process noise.** ε̄ is the exponentially weighted mean of the bearing NIS ν²/S over 6
  samples (60 s), reset to 1 at each re-initialisation. Each prediction uses
  σa_eff = min(a, σa · sqrt(max(1, ε̄ / e))), with σa 0.03 (the reference's).

## G.2 Data

Seed 217's validation split with the phase-7 ranges, regenerated as phase 11 made it; T2 normalised
from seed 211's train split. `run.sh` checks that the regenerated references and T2 reproduce phase
15's validation medians exactly. This is the tenth selection on seed 217.

**The design probe.** The NIS thresholds were placed from seed 235 (a 1,000-scenario split, never a
gate split; `scripts/research/spec029-nis-probe.mjs`): the reference EKF's ε̄ at G5 rows has median
0.035 on straight legs, 0.052 settled after a manoeuvre and 0.058 unsettled (p90 0.095, 0.19,
0.24). Thresholds of 1 or more would never fire, because R is inflated 64 ×.

## G.3 The grid and the selection

- **The grid** (`configs/phase16/fusion-grid.json`): the EKF at σa 0.03, P0 × 16, R × 64, guarded
  initialisation 1; k 4, M 3 (Annex F's); fade c ∈ {0, 0.5, 1, 2} × ceiling a ∈ {0.07, 0.1, 0.2} ×
  threshold e ∈ {0.03, 0.06, 0.12}: 36 variants.
- **The score** (`scripts/research/spec029-fuse-grid.mjs`): Annex F's, plus straight-leg course
  (settled rows before any manoeuvre, limit 1.1). Six point ratios of medians against each
  re-tuned reference; a check's margin is (limit − point) / limit; the score is the smallest
  margin over both references.
- **The rule.** The highest score is carried, if it is above 0. Ties within 0.005 go to the smaller
  ceiling, then the larger threshold, then the smaller fade (the least change first). The gate's
  reference is the re-tuned tracker the carried variant's margin is smaller against (ties: the
  EKF). Otherwise Annex G stops at validation.
- **Reported:** phase 15's tracker (σa 0.07, no fade), T2, and the references on all three row sets.
- **Forecast, stated before scoring.** A stop at validation is more likely than not (about 65%).
  The probe's NIS separates straight legs from manoeuvres only weakly, so σa will rise on some
  straight legs and lag after some manoeuvres. The binding check is likely overall course against
  the IMM (phase 15's σa-0.03 fusion was 1.15 ×) or straight-leg course against the EKF.

## G.4 The gate

G5's rules (Annex C §C.5) plus the straight-leg check, on the same rows and bootstrap
(`tma-g5 --straight-leg`; decisions carry `straight_leg_check`, schema 0.24.0): six gated checks,
97.5% scenario-clustered intervals, FR-015 verdict, spec 015's bindings.

- **Seeds.** Decision 44 fixes fresh seed 236 (400,000; a 40,000-scenario test split, phase-7
  ranges). One re-score, if the first is inconclusive, on seed 237 (1,100,000; 110,000). A fail or
  inconclusive there is final. Seed 235 is the design probe and is never a gate split.
- **Reported, not gated:** the other re-tuned reference, phase 15's tracker, T2, batch least
  squares and naive.
- **Panel.** Five reviewers.

## G.5 What follows

- **Pass:** the range aid no longer costs straight-leg course against the re-tuned reference, and
  still beats it overall.
- **Stop or fail:** the straight-leg cost of fusing T2 under this error model is recorded as not
  removed by a fade and adaptive σa; the owner decides.
