# Phase 15 validation (spec 028, SRD Annex F): T2's range fused into the EKF

**Data.** Seed 217's validation split with the phase-7 ranges: 16,711 G5 rows (σ = 1°,
zig + 5/10/15/20 min). This is the ninth selection on this split. The inputs' digests were checked
against phase 14's `inputs.sha256` before scoring.

**Pre-registration.** Annex F, the grid (`configs/phase15/fusion-grid.json`), the code,
`scripts/research/spec028-rows.mjs`, `spec028-fuse-grid.mjs` and `run.sh` were committed in
65666f4 before any variant was scored. Outputs: `grid.json`, per-variant file digests in
`variants.sha256`, Annex E's best IMM fusion's in `fused-imm.sha256`; the G5 diagnostic in `g5/`.

## Outcome

**Carried.** Five of 96 variants score above 0, all at σa 0.07. The best score is 0.018 (k 3,
M 6); the tie rule (within 0.005, larger k) carries **`fused-lstm-gaussian-ekf-sa0.07-p16-r64-g1-k4-m3`**
(score 0.015). Its smaller margin is against the EKF (settled course), so the gate's reference is
the re-tuned EKF `ekf-sa0.03-p16-r64-g1`.

The forecast was half right. The binding check did move to overall course against the IMM, but
for σa ≤ 0.05 only. At σa 0.07 settled course against the EKF binds again; 56 variants bind
there, 40 on overall course against the IMM.

## Best variant per σa (ratios: against the EKF | against the IMM)

| σa | k, M | Score | Range, course, settled range, course, speed vs EKF | Same vs IMM |
| --- | --- | --- | --- | --- |
| 0.03 | 3, 1 | −0.148 | 0.79, 0.93, 0.88, 1.05, 0.94 | 0.83, **1.15**, 0.89, 0.74, 0.80 |
| 0.05 | 4, 1 | −0.043 | 0.79, 0.85, 0.88, 1.06, 1.00 | 0.83, **1.04**, 0.89, 0.75, 0.85 |
| **0.07** | **4, 3** | **0.015** | 0.79, 0.80, 0.87, **1.08**, 1.02 | 0.83, **0.98**, 0.88, 0.77, 0.87 |
| 0.1 | 4, 12 | −0.056 | 0.81, 0.76, 0.87, **1.16**, 1.07 | 0.85, 0.94, 0.89, 0.82, 0.90 |

The σa 0.07 row is the carried variant, not the best score (k 3, M 6: 0.018).

## Medians on the G5 rows

| Estimator | Range | Course | Speed | Settled range | Settled course | Settled speed |
| --- | --- | --- | --- | --- | --- | --- |
| **EKF-fused (carried)** | **12.5%** | 28.1° | 2.10 kt | **11.8%** | 9.0° | 1.83 kt |
| Re-tuned EKF | 15.8% | 35.2° | 2.31 kt | 13.6% | **8.3°** | **1.78 kt** |
| Re-tuned IMM | 15.1% | 28.6° | 2.54 kt | 13.4% | 11.7° | 2.10 kt |
| IMM-fused (Annex E best) | 12.5% | 26.5° | 2.28 kt | 11.5% | 10.7° | 1.87 kt |
| T2 | 12.2% | **25.1°** | 2.87 kt | 11.9% | 17.7° | 2.64 kt |
| Least squares (spec 026) | 17.3% | | | | | |
| Naive | 38.7% | | | | | |

## G5 diagnostic against the re-tuned EKF (`g5/diagnostic.json`, 97.5% intervals)

| Check | Point | Interval | Limit | |
| --- | --- | --- | --- | --- |
| Overall range | 0.790 | [0.759, 0.820] | 1 | pass |
| Overall course | 0.798 | [0.778, 0.820] | 1 | pass |
| Settled range | 0.867 | [0.823, 0.916] | 1.1 | pass |
| **Settled course** | **1.083** | **[0.997, 1.169]** | 1.1 | **inconclusive** |
| Settled speed | 1.024 | [0.971, 1.085] | 1.1 | pass |

## Critical reading

- **The trade-off is the one Annex F forecast; the window between its two sides is narrow.**
  Raising σa buys overall course against the IMM (1.15 → 0.94 ×) and spends settled course
  against the EKF (1.05 → 1.16 ×). Only σa 0.07 fits both, and by under 2%.
- **The EKF fusion did what the IMM fusion could not on settled course** (9.0° against 10.7°),
  and kept the range gain (12.5%, as the IMM fusion). It gives up overall course against the IMM
  fusion (28.1° against 26.5°).
- **The carried margin is within selection noise.** Five variants out of 96 pass, at one σa, by
  0.010–0.018, on the split they were chosen on. The settled-course interval spans 1.1. Expect the
  test point to rise, not fall.
- **The gate checks the EKF only.** Against the IMM, overall course is 0.98 ×, a 2% margin. It is
  reported, not gated (Annex F §F.4); a pass would not show the fused tracker beats the IMM on
  course.
- **T2 alone still has the lowest overall course** (25.1°) and almost the same range (12.2%);
  fusion's value is settled course and speed, where T2 is worst.
- **Limits.** One seed, validation only; one error family at ×1; T2 frozen.

## Consequence

Annex F §F.4: decision 43 (`experiments/20261116-p15-decision/`) fixes the gate on fresh seed 233.
