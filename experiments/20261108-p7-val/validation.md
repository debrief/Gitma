# Phase 7 validation (spec 019, SRD Annex C §C.14): seed 217

This is the frozen `-g1` fused tracker
(`fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`) against the frozen `-g1` IMM
(`imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`). They are scored by `tma-g5` as a diagnostic on seed
217's 10,000-scenario validation split with realistic bearing error (`configs/phase7-ranges.json`).
- **The clean twin.** The same rows were regenerated with the phase-4 ranges. Generator 0.6.0 keeps
  the geometry and the white noise, so only the added error differs between the two.
- **Order.** `scripts/research/spec019-clean.mjs` and `run.sh` were committed before any seed-217
  data existed (4925b73, 192d124).
- **T2's normalisation.** T2's features use seed 211's train split. Regenerated at 0.6.0, its
  content digest is the plans' 870aff4e…, unchanged.

Commands: `run.sh`. Hashes: `predictions.sha256`. Diagnostics: `g5-real/`, `g5-clean/`. Clean
comparison: `clean.json`, and `clean-ekf.json` for the EKF against the IMM.

## G5 diagnostic, realistic bearing error (97.5% CIs; 10,000 scenarios)

| Check | Fused / IMM | Limit | Point within its limit |
| --- | --- | --- | --- |
| Overall range | 0.777 [0.756, 0.798] | < 1 | yes |
| Overall course | 0.922 [0.896, 0.942] | < 1 | yes |
| Settled range | 0.778 [0.748, 0.813] | < 1.1 | yes |
| Settled course | 0.876 [0.839, 0.904] | < 1.1 | yes |
| Settled speed | 0.889 [0.854, 0.931] | < 1.1 | yes |
| Speed (reported) | 0.930 [0.904, 0.956] | | |
| Gross-error rate (reported) | −6.69 pp [−7.39, −5.97] | | |

**Carried.** Every point estimate is within its limit (§C.14's rule), so the fused tracker goes
to G5 on seed 218. Every interval is also wholly within its limit, but that is not the rule.

**On the clean twin** the fused tracker also passes every check: range 0.844, course 0.932, settled
range 0.880, settled course 0.943, settled speed 0.897. These are close to the phase-4c gate on seed
214, which had range 0.824 and course 0.947.

**The EKF** (`-g1`, reported) does worse than the IMM with realistic error on overall course: 1.034
[1.002, 1.066]. It does better on settled course (0.681) and speed (0.793), as on clean data.

## Clean comparison (reported; 95% scenario-clustered bootstrap, 2,000 resamples)

Each value is a realistic/clean ratio of median error on the same rows.

| Rows, metric | Fused | IMM | Interaction (fused/IMM, realistic ÷ clean) |
| --- | --- | --- | --- |
| All, range | 1.692 [1.636, 1.752] | 1.839 [1.776, 1.907] | **0.920 [0.888, 0.954]** |
| All, course | 1.289 [1.245, 1.328] | 1.303 [1.253, 1.353] | 0.989 [0.956, 1.019] |
| Settled, range | 1.850 [1.766, 1.948] | 2.093 [1.989, 2.205] | **0.884 [0.839, 0.936]** |
| Settled, course | 1.909 [1.822, 1.996] | 2.057 [1.971, 2.164] | **0.928 [0.881, 0.967]** |

EKF against IMM: overall range interaction 0.929 [0.902, 0.958], overall course 0.846; settled
1.00 for both.

## Reading

- **Every tracker is much worse with this error.** Median range error is 1.7–1.8 × its clean
  value overall and about 2 × on settled rows. Median course error is 1.3 × overall and about 2 ×
  settled. The doubled severity is not mild for any of them.
- **The fused tracker degrades least on range.** Its advantage over the IMM grows from 0.84 × to
  0.78 × overall, and from 0.88 × to 0.78 × on settled rows. A plausible reason: T2's range,
  learned over the whole history, averages over the slowly drifting bias better than the IMM's
  recursive update. Validation cannot test that mechanism.
- **Course: no reliable change overall** (interaction 0.99). On settled rows the fused tracker
  degrades a little less.
- **Limits.** This is one error model at one severity, with frozen trackers that never saw
  correlated error. It is validation, not the gate.
