# Phase 16 validation (spec 029, SRD Annex G): range fade and adaptive process noise

**Data.** Seed 217's validation split with the phase-7 ranges, regenerated: 16,711 G5 rows, 7,509
settled, 4,205 settled before any manoeuvre ("straight legs"). The regenerated re-tuned IMM, EKF
and T2 reproduce phase 15's validation medians exactly (`run.sh` step 3). Tenth selection on seed
217.

**Pre-registration.** Annex G, the grid (`configs/phase16/fusion-grid.json`), the NIS probe
(seed 235), the code, `spec029-rows.mjs`, `spec029-fuse-grid.mjs` and `run.sh` were committed in
f02ae28 before any variant was scored. Outputs: `grid.json`, `inputs.sha256`, `variants.sha256`.

## Outcome

**Stopped at validation.** The best score is −0.129 (fade 1, ceiling 0.07, threshold 0.06); no
variant beats both references on all six checks. 22 variants bind on straight-leg course against
the EKF, 14 on overall course against the IMM. Seeds 236–237 are not generated and stay reserved.
The forecast (a stop, about 65%; binding on one of these two checks) held.

Even against one reference at a time nothing passes: the best margin against the EKF alone is
−0.005 (straight-leg course 1.106), against the IMM alone −0.041 (overall course 1.041).

## Medians (G5 rows)

| Estimator | Range | Course | Settled course | Straight-leg course | Straight-leg range |
| --- | --- | --- | --- | --- | --- |
| Re-tuned EKF (σa 0.03) | 15.8% | 35.2° | 8.3° | **3.1°** | **8.7%** |
| Re-tuned IMM | 15.1% | **28.6°** | 11.7° | 7.5° | 9.9% |
| Phase 15 (σa 0.07, no fade) | 12.5% | 28.1° | 9.0° | 5.0° | 10.1% |
| Fade 0, ceiling 0.07, threshold 0.06 | 12.5% | 31.5° | 8.5° | 4.0° | 9.9% |
| Fade 1, same | 13.2% | 32.3° | 8.4° | 3.7° | 9.2% |
| Fade 2, same | 13.9% | 32.7° | 8.5° | 3.6° | 8.9% |
| Fade 0, ceiling 0.2, threshold 0.03 | 12.6% | 29.8° | 9.6° | 5.4° | 10.2% |
| Fade 0, ceiling 0.2, threshold 0.12 | 12.5% | 32.6° | 8.5° | 3.8° | 9.8% |
| T2 | 12.2% | 25.1° | 17.7° | 15.4° | 10.4% |
| Least squares (spec 026, same split) | 17.3% | | | 2.0° (spec 026) | 6.9% |
| Naive | 38.7% | | | | |

## Critical reading

- **The trade-off is the same one, on a new axis.** A threshold that lets σa rise often (0.03)
  recovers overall course (29.8°, still 1.04 × the IMM) and spends straight-leg course (5.4°,
  1.74 × the EKF); a high threshold does the reverse. The averaged bearing NIS does not separate a
  manoeuvre from correlated bearing error well enough, as the seed-235 probe warned (median 0.035
  on straight legs against 0.058 unsettled).
- **The fade works as designed, but costs more than it saves.** At fixed adaptation, fade 0 → 2
  cuts straight-leg course 4.0° → 3.6° and straight-leg range 9.9% → 8.9%, toward the EKF's 3.1°
  and 8.7%. It also gives up the network's range everywhere else: overall range 12.5% → 13.9% and
  overall course 31.5° → 32.7°.
- **Fusion itself costs straight-leg course even at the reference's σa.** With σa near 0.03 the
  fused tracker's straight-leg course is still 1.2 × the EKF's (3.8° against 3.1°). T2's range,
  correlated in time, nudges the velocity through the position–velocity covariance.
- **Against phase 15's tracker** the best variants trade 3–4° of overall course for 1–1.4° of
  straight-leg course. Phase 15 remains the better compromise for overall accuracy; it is the only
  one that passed a gate.
- **Limits.** One seed, validation only, no intervals; one error family at ×1; T2 frozen; one NIS
  window (60 s) and one form of adaptation.

## Consequence

Annex G §G.5, stop: under this error model, neither a fading range weight nor NIS-adaptive process
noise removes the EKF fusion's straight-leg cost without losing its overall gain. The owner decides.
