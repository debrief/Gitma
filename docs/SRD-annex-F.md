# SRD Annex F: the network's range fused into the EKF

Nov 16, 2026 · annex to [SRD.md](SRD.md)

## F.0 Status and scope

Annex E stopped at validation (§E.6). The fused tracker rebuilt on the re-tuned IMM beat both
re-tuned references on range, 0.79 × the EKF's, but its course after a manoeuvre was 1.29 × the
re-tuned EKF's, over G5's 1.1 limit. The network fixes range; the IMM it feeds sets the course,
and a constant-velocity EKF holds course better on settled legs.

The owner's decision (2026-11-16):

- **F1, the design:** fuse the frozen T2's range into the EKF instead of the IMM.

Unchanged from Annex E, by the owner's earlier decisions E2 and E3: a scored gate on a fresh seed
with a review panel, against the harder of the two re-tuned references. The rest of this annex was
written by the implementing agent. It stands unless the owner amends it before decision 43 is
committed.

## F.1 The design

`fusedEkfPredict` (`@tma/classical`; `tma-fuse-track --filter ekf --sigma-a <a>`): the EKF's rows,
re-initialisation included, with T2's range entering after each bearing update as a log-range
measurement, z = ln ρ, H = [dx/ρ², dy/ρ², 0, 0], R = (k × T2's stated log-range sd)², every M
samples from zig_index + 1. The schedule and the guard on unusable rows are the IMM fusion's
(spec 014, spec 015 FR-004). Names: `fused-<network>-<ekf name>-k<k>-m<M>`; spec 015's binding
re-computes them (`parseFusedEkfName`).

A constant-velocity EKF has no manoeuvre model. After a turn, only its process noise σa and the
range measurement let it recover. A larger σa recovers faster and holds course worse on straight
legs.

## F.2 Data

Seed 217's validation split with the phase-7 ranges (16,711 G5 rows), its frozen T2 predictions
(phase 11), and Annex E's re-tuned references, whose digests `run.sh` checks against
`experiments/20261115-p14-val/inputs.sha256`. This is the ninth selection on seed 217.

## F.3 The grid and the selection

- **The grid** (`configs/phase15/fusion-grid.json`): the EKF at Annex E's re-tuned P0 × 16 and
  R × 64 (guarded initialisation level 1), over σa ∈ {0.03, 0.05, 0.07, 0.1} × k ∈ {0.5, 1, 1.5,
  2, 3, 4} × M ∈ {1, 3, 6, 12}: 96 variants.
- **Why that σa range.** Annex E's committed tuning (`tune.json`) brackets the trade-off: at
  σa 0.03 the EKF's overall course is 35.2° and its settled course 8.3°; at 0.1, 29.3° and 10.7°.
  The re-tuned IMM's overall course is 28.6°. Below 0.03 overall course worsens (0.01: 40.5°); at
  0.3 settled course is 17.4°.
- **The score** (`scripts/research/spec028-fuse-grid.mjs`): Annex E's. For each variant and each
  re-tuned reference, G5's five point ratios of medians (overall range and course, limit 1; settled
  range, course and speed, limit 1.1). A check's margin is (limit − point) / limit; a variant's
  score is its smallest margin over both references.
- **The rule.** The highest score is carried, if it is above 0. Ties within 0.005 go to the larger
  k, then the larger M, then the smaller σa. The gate's reference is the re-tuned tracker the
  carried variant's margin is smaller against (ties: the EKF). Otherwise Annex F stops at
  validation.
- **Mechanics.** Each variant's G5-row errors are extracted (`spec028-rows.mjs`) and its
  per-timestep file deleted; file digests are kept (`variants.sha256`).
- **Forecast, stated before scoring.** The binding check moves from settled course against the
  EKF to overall course against the IMM. At σa 0.03 the EKF's overall course is 1.23 × the IMM's;
  fusion cut the IMM's own by only 7% in Annex E. A larger σa closes that but costs settled course.
  A stop at validation is more likely than not.

## F.4 The gate

G5's rules, unchanged (Annex C §C.5): five gated checks on σ = 1° rows at zig + 5/10/15/20 min,
scenario-clustered paired bootstrap, 97.5% intervals, FR-015 verdict, spec 015's bindings.

- **Seeds.** Decision 43 fixes fresh seed 233: 400,000 scenarios with the phase-7 ranges, whose
  test split has 40,000. One re-score, if the first is inconclusive, on seed 234 (1,100,000;
  110,000). A fail or inconclusive there is final. Both are generated only if a variant is carried.
- **Reported, not gated:** the other re-tuned reference, Annex E's best IMM fusion, T2, batch least
  squares and naive.
- **Panel.** Five reviewers, as for every gate.

## F.5 What follows

- **Pass:** the qualified go's reference condition is met by the EKF-fused tracker.
- **Stop or fail:** the go/no-go report records that no fusion of T2's range tried here beats both
  re-tuned classical trackers, and the owner decides.

## F.6 Outcome (2026-11-16)

**G5 passed on seed 233** (`experiments/20261116-p15-g5/`, panel `review.md`). Validation
carried `fused-lstm-gaussian-ekf-sa0.07-p16-r64-g1-k4-m3` (score 0.015, five of 96 variants above
0); the reference is the re-tuned EKF. Against it: overall range 0.782 [0.767, 0.795], course
0.819 [0.809, 0.830]; settled range 0.837, course 1.043 [1.013, 1.078], speed 0.973. The forecast
had a pass at about 10%.

What the pass does not show (panel round 1):

- **Against the re-tuned IMM** (reported): range 0.81 ×, overall course 0.991 [0.976, 1.005].
- **About half the course gain is σa.** A plain EKF at σa 0.07 fails the same gate (range 1.027,
  settled course 1.123); the range gain is T2's.
- **On straight legs before any manoeuvre** the fused tracker is worse than the reference EKF:
  course 1.57 ×, range 1.10 ×. The pooled settled check passes because the after-manoeuvre rows
  (course 0.67 ×) make up 45% of settled rows.
- **T2 alone** keeps the lowest overall range and course.

Seed 234 was not generated and stays reserved.
