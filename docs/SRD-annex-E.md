# SRD Annex E: re-tuned references under realistic bearing error

Nov 15, 2026 · annex to [SRD.md](SRD.md)

## E.0 Status and scope

The go/no-go report puts two conditions on the qualified go that spec 026's severity sweep sharpened:

- **The reference was tuned on white noise.** Every G5 verdict under realistic error (phases 7–11)
  compared against the frozen `-g1` IMM, tuned on white noise. The IMM degrades fastest as
  correlated error grows. The EKF beats the fused tracker on settled course by 1.27–1.41 ×.
- **The fusion runs on that IMM.** Phase 8 re-tuned k and M, but kept the white-noise IMM inside.

The owner's decisions (2026-11-15):

- **E1, the work:** re-tune both the classical references and the fused tracker's IMM to realistic
  bearing error. No training; T2 stays frozen.
- **E2, the rigour:** a scored gate on a fresh seed, with a review panel.
- **E3, the reference:** the better re-tuned classical tracker, IMM or EKF; the harder of the two.

The rest of this annex was written by the implementing agent. It stands unless the owner amends it
before decision 42 is committed.

## E.1 Data

Seed 217's validation split with the phase-7 ranges (16,711 G5 rows), its frozen T2 predictions
and the frozen fused tracker's, all from phase 11 (`experiments/20261114-p11-val/`). This is the
eighth selection on seed 217; the fresh test seed protects the verdict, not the design.

## E.2 Re-tuning the references

- **Procedure.** Decision 29's (spec012-tune): the objective is the median range error over every
  G5 row, with non-converged rows infinite. The IMM is scored in two stages (all settings on the
  first 400 scenarios, then the 12 best on all). The EKF grid is scored on all.
- **Changes from decision 29.** The guarded initialisation at level 1 throughout (decision 32);
  course medians reported; ties within 0.0005 go to the larger r_scale, then the smaller process
  noise.
- **The grid** (`configs/phase14/tracker-grid.json`):
  - EKF: σ_a ∈ {0.003, 0.01, 0.03, 0.1, 0.3} × P0 ∈ {4, 16} × R ∈ {4, 8, 16, 32, 64};
  - IMM: σ_cv ∈ {0, 0.003, 0.01, 0.03} × σ_ct ∈ {0.03, 0.1, 0.3} × σ_ω ∈ {0.003, 0.01, 0.03} ×
    switch ∈ {0.0003, 0.001, 0.003} × P0 ∈ {4, 16} × R ∈ {8, 16, 32, 64}: 864 settings.
- **The edge rule.** If a winner sits on the upper edge of R or P0, that axis is doubled for the
  settings at the edge and scored on all scenarios, up to four times.
- **Pre-registration.** `scripts/research/spec027-tune.mjs` and `run.sh`
  (`experiments/20261115-p14-val/`) are committed before any setting is scored.

## E.3 The fused tracker and the reference

- **The candidates.** The frozen T2's range fused into the re-tuned IMM (`tma-fuse-track`, guarded
  level 1), over phase 8's grid: k ∈ {0.5, 1, 1.5, 2, 3, 4} × M ∈ {1, 3, 6, 12}, 24 variants.
- **The score** (`scripts/research/spec027-fuse-grid.mjs`). For each variant and each re-tuned
  reference, G5's five point ratios: overall range and course (limit 1), settled range, course and
  speed (limit 1.1). The margin of a check is (limit − point) / limit. A variant's score is its
  smallest margin over both references: it must beat both.
- **The rule.** The highest score is carried, if it is above 0. Ties within 0.005 go to the larger
  k, then the larger M. The gate's reference is the re-tuned tracker the carried variant's margin
  is smaller against (ties: the EKF). Otherwise Annex E stops at validation.
- **Forecast, stated before scoring.** The EKF is likely to bind. The frozen fused tracker's
  settled course was 1.27–1.41 × the EKF's; fusing into a re-tuned IMM may not close that.

## E.4 The gate

G5's rules, unchanged (Annex C §C.5): five gated checks on σ = 1° rows at zig + 5/10/15/20 min,
scenario-clustered paired bootstrap, 97.5% intervals, FR-015 verdict. The carried fused variant
is judged against the reference chosen in §E.3, both by name, with spec 015's bindings (`tma-g5`).

- **Seeds.** Decision 42 fixes fresh seed 231: 400,000 scenarios with the phase-7 ranges, whose
  test split has 40,000. One re-score, if the first is inconclusive, on seed 232 (1,100,000;
  110,000). A fail or inconclusive there is final. Both are generated only if a variant is
  carried.
- **Reported, not gated:** the other re-tuned reference, the frozen `-g1` IMM and fused tracker,
  T2, batch least squares and naive.
- **Panel.** Five reviewers, as for every gate.

## E.5 What follows

- **Pass:** the qualified go's reference condition is met. The fused tracker beats the best
  classical tracker re-tuned to the same error.
- **Stop or fail:** the go/no-go report records that the fused tracker's gain does not survive a
  re-tuned reference, and the owner decides.
