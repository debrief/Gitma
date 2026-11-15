# Phase 14 validation (spec 027, SRD Annex E): re-tuned references

**Data.** Seed 217's validation split with the phase-7 ranges (realistic error, ×1): 10,000
scenarios, 16,711 G5 rows (σ = 1°, zig + 5/10/15/20 min), of which those settled after a
manoeuvre form the settled checks. This is the eighth selection on this split.

**Pre-registration.** Annex E, the grid (`configs/phase14/tracker-grid.json`),
`scripts/research/spec027-tune.mjs`, `scripts/research/spec027-fuse-grid.mjs` and `run.sh` were
committed in 4a05892 before any scoring. Outputs: `tune.json`, `grid.json`; hashes in
`inputs.sha256`.

## Outcome

**Stopped at validation.** The best variant, k 4, M 12 on the re-tuned IMM, scores −0.173. Its
binding check is settled course against the re-tuned EKF, 1.29 × (limit 1.1). No variant beats
both references, so seed 231 is not generated and stays reserved with 232. The forecast in §E.3
(the EKF binds on settled course) held.

## The re-tuned references

| Tracker | Range | Course | Settled range | Settled course | Settled speed |
| --- | --- | --- | --- | --- | --- |
| EKF, frozen `ekf-sa0.03-p4-r8-g1` | 16.1% | — | — | — | — |
| **EKF, re-tuned `ekf-sa0.03-p16-r64-g1`** | 15.8% | 35.2° | 13.6% | **8.3°** | **1.78 kt** |
| IMM, frozen `-g1` | 16.7% | — | — | — | — |
| **IMM, re-tuned `imm-cv0-ct0.03-w0.01-s0.001-p32-r64-g1`** | 15.1% | 28.6° | 13.4% | 11.7° | 2.10 kt |
| T2 | 12.2% | 25.1° | 11.9% | 17.7° | 2.64 kt |
| Fused tracker, frozen (k 4, M 6, frozen IMM) | 12.9% | 26.5° | 11.7% | 12.6° | 2.14 kt |
| **Best fused, re-tuned IMM (k 4, M 12)** | **12.5%** | 26.5° | **11.5%** | 10.7° | 1.87 kt |
| Least squares (spec 026, same rows) | 17.3% | | | | |
| Naive (same rows) | 38.7% | | | | |

Medians over G5 rows. Frozen-tracker range medians are spec 026's ×1 column (same rows).

- Re-tuning gains 2% on the EKF's range and 10% on the IMM's. Both winners inflate the
  measurement noise (R × 64): correlated error is absorbed as heavier white noise.
- Neither winner is edge-limited. The edge rule tried R × 128 and P0 × 64 and neither won.
- The EKF's tie rule (range within 0.0005 → larger R) chose R × 64 (15.79%) over R × 32 (15.75%).

## The fusion grid (best five of 24 by score)

| k | M | vs EKF: range, course, settled range, course, speed | vs IMM: same | Score |
| --- | --- | --- | --- | --- |
| 4 | 12 | 0.79, 0.75, 0.85, **1.29**, 1.05 | 0.83, 0.92, 0.86, 0.91, 0.89 | **−0.173** |
| 4 | 3 | 0.78, 0.76, 0.86, 1.32, 1.04 | 0.82, 0.93, 0.88, 0.94, 0.88 | −0.203 |
| 4 | 6 | 0.79, 0.75, 0.85, 1.33, 1.04 | 0.82, 0.92, 0.87, 0.94, 0.88 | −0.209 |
| 3 | 6 | 0.79, 0.75, 0.87, 1.33, 1.02 | 0.82, 0.92, 0.88, 0.94, 0.86 | −0.210 |
| 3 | 12 | 0.79, 0.75, 0.86, 1.34, 1.06 | 0.83, 0.93, 0.87, 0.95, 0.90 | −0.221 |

Every variant fails settled course against the EKF (1.29–2.30 ×). The frozen fused tracker would
score −0.383 (settled course 1.52 ×, settled speed 1.20 × the re-tuned EKF's).

## Critical reading

- **The loss is in dynamics, not range.** Every variant beats both references on range, by
  15–22%. Fusion feeds the network's range into the IMM but leaves the IMM's course behaviour,
  and on settled legs a single constant-velocity EKF with small process noise holds course better
  (8.3° against 10.7°). A larger k only narrows the gap (2.30 × at k 0.5, 1.29 × at k 4).
- **Against the re-tuned IMM alone, the gate would have been reached.** 15 of 24 variants beat it
  on all five checks (best margin 0.080, k 3, M 6). The choice of the harder reference (E3)
  decided the outcome.
- **The EKF is tuned for range, not course,** as in decision 29. A course-tuned EKF would be
  harder still (grid settled course 8.1–9.1°), so the stop is not an artefact of a weak tuning.
- **Selection is optimistic.** References and fusion were all chosen on this split; the bias
  favours every tracker equally, and nothing is gated on it.
- **Not tried:** fusing the network's range into the EKF instead of the IMM. That would attack the
  binding check directly but loses the IMM's manoeuvre handling, and it is a new design (a new
  annex), not a re-tune.
- **Limits.** One seed, validation only, no intervals; one error family at ×1; T2 frozen.

## Consequence

Annex E §E.5, stop: the fused tracker's range gain survives a re-tuned reference (0.79 × the
EKF's range), but its course after a manoeuvre does not match a re-tuned EKF's. Condition 2 of the
qualified go is not met. The owner decides.
