# G5 review: phase 7, realistic bearing error (spec 019, decision 35)

**Judged:** the frozen `-g1` fused tracker
(`fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`) against the frozen `-g1` IMM.
**Data:** seed 218, a 40,000-scenario test split with realistic bearing error. That error is a
Gauss–Markov term of 1.0° / 30 s plus a drifting bias of 0.5° / 20 min.

The machine verdict is **pass**, and every check is wholly within its limit:

| Fused / IMM (97.5% CI) | Ratio | Limit |
| --- | --- | --- |
| Overall range | 0.766 [0.755, 0.778] | < 1 |
| Overall course | 0.907 [0.897, 0.918] | < 1 |
| Settled range | 0.774 [0.758, 0.788] | < 1.1 |
| Settled course | 0.875 [0.859, 0.890] | < 1.1 |
| Settled speed | 0.907 [0.888, 0.926] | < 1.1 |

## Round 1 (five independent reviewers, read-only)

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 3 | 2 |
| Estimation and numerics | approve-with-findings | 0 | 3 | 3 |
| Evaluation statistics | approve-with-findings | 0 | 0 | 8 |
| Reproducibility | approve | 0 | 0 | 2 |
| Red team | approve-with-findings | 0 | 2 | 3 |

All five agree that **pass** is the correct machine verdict. None found leakage, tuning on seed
217 or 218, or a break in pre-registration.

- **Independent recomputation** (geometry). The reviewer recomputed every median and both ratios
  over all 40,000 scenarios with code of its own. The scored bearings carry the declared error:
  residual sd 1.5002° on 5.07 M σ = 1° bearings, and lag correlations within 0.001 of the model.
- **Pre-registration** (statistics, red team). The order was:
  1. the clean-comparison script, 4925b73;
  2. the validation run.sh;
  3. decision 35, b1021fd;
  4. the G5 run.sh, 4977e4b;
  5. data generated clean at 4977e4b;
  6. the verdict, 733abec;
  7. the clean twin, dated after the verdict.

  The plan's content digest (536a8677…) and its ranges binding both hold. There is one
  `scoring.json`.
- **No leakage** (red team). T2's normalisation constants equal its manifest's, computed from
  seed-211 inputs.
- **Reproduction** (reproducibility). All hashes and plan digests verify. Re-running the gate with
  `--repeat-of` gave a byte-identical `verdict.json` and `report.json`, and a `scoring.json` that
  differs only by `repeat_of`. Both sampled trackers recomputed byte-identically.

### Major findings and responses

| # | Finding (reviewers) | Response |
| --- | --- | --- |
| M1 | **T2 alone beats the fused tracker on range.** Overall it is 12.1% against 13.2%: fused/T2 is 1.095 [1.080, 1.113] and settled 1.044 [1.022, 1.064]. T2 also wins on overall course (1.044) and range P90 (0.35 against 0.42), and it never fails to converge. The fusion at k = 4 now gives T2 too little weight: the IMM is biased about −7% in range under the drifting bias, while T2 is nearly unbiased. Fusion keeps one coherent state; it is not the best range estimator here. (geometry, estimation, red team) | **Agreed; stated in every write-up.** The ratios are in `baselines.json` (scenario-clustered 97.5% intervals). The fused tracker still beats T2 on settled course (0.744) and settled speed (0.824). The pass shows the fused tracker beats the frozen IMM; it does not show that fusing adds range accuracy over T2 under this error. Re-tuning k is a separate decision, needing a new seed. |
| M2 | **The EKF beats the fused tracker on settled course and speed.** Settled course is 10.6° against 13.5° (fused/EKF 1.268 [1.232, 1.303]); before any manoeuvre it is 5.4° against 9.5° (1.762). The same limit held in phase 4c. (geometry, estimation, red team) | **Agreed; stated.** On overall range (0.787) and course (0.879) the fused tracker beats the EKF. |
| M3 | **The absolute errors and baselines must sit beside the ratios.** AGENTS.md requires naive and classical baselines on the same test set, and they were missing. The absolute errors are large: fused median range 13.2%, course 27°, course P90 106°. (geometry, estimation) | **Fixed.** `baselines.json` adds medians and P90s for the fused tracker, IMM, T2, EKF and naive, overall, settled, and settled before and after any manoeuvre. `lsq.json` adds batch least squares. Least squares is the best estimator on straight legs before any manoeuvre: range 7.3%, course 2.2°. Over all rows it is 17.6% and 46.7°. Naive is 40% and 90°. The write-ups give the absolute numbers. |
| M4 | **The reference is frozen, not adapted to the new error.** Neither tracker models coloured or bias error. The IMM's gross-error rate roughly doubles (13.2% against the fused tracker's 6.7%). The pass shows that a frozen-against-frozen advantage survives; it does not show that the advantage would survive against an IMM with inflated R or a bias state. (red team, estimation) | **Agreed; stated** beside every "the advantage survives". |

### The clean comparison (seed 218; reported after the verdict, as pre-registered)

Each value is the ratio of median error, realistic over clean, on the same rows, with a 95%
scenario-clustered interval.

| Overall range | Realistic / clean | Interaction against the IMM |
| --- | --- | --- |
| T2 alone | 1.465 [1.445, 1.485] | 0.805 [0.788, 0.822] |
| Fused | 1.684 [1.656, 1.710] | 0.925 [0.910, 0.942] |
| EKF | 1.722 [1.692, 1.752] | 0.946 [0.933, 0.961] |
| IMM | 1.820 [1.786, 1.853] | |

Every tracker degrades by about 1.5–2.1 ×, settled rows the most. T2 alone is the most robust on
range, and on settled course (interaction 0.788). The fused tracker lies between T2 and the IMM.
The mechanism (T2 avoids the IMM's range bias) is supported by the estimation reviewer's
signed-error figures, but it is a hypothesis, not a test.

### Minor findings and responses

- **The pre-decision digest pin** (statistics, red team). It is disclosed in `decision.md`:
  generated at 192d124, digest taken, deleted, and nothing run on it. `packages/` is identical
  between 192d124 and 4977e4b.
- **Non-converged rows** are 617 for the fused tracker, 703 for the IMM, 0 for T2 and 416 for the
  EKF, out of 67,261 (estimation, geometry). They are scored as +∞, and the failed rows of the two
  trackers are not nested. On rows where all three converge, T2 still beats the fused tracker
  (estimation).
- **Settled rows before any manoeuvre now favour the fused tracker** (statistics): 0.842 × the IMM
  in range, where phase 4c had about 1.03 ×. Noted.
- **Scope** (statistics, red team). The pass covers one frozen tracker, one error model, one
  severity, σ = 1° rows and simulated data. A false pass is at most about 2.5%. The result was
  forecast at about 95%, and validation and test agree (0.777 → 0.766).
- **NIS, NEES and non-PD counts were not measured under correlated error** (estimation). The NIS
  is inflated by design, since the filters assume white noise. They are not measured here; this is
  recorded as a limit.
- **Committing the clean-comparison outputs before `decided_by`** (red team): done (dd6e081,
  and this commit).
- **Run time and memory** (reproducibility). The gate step takes about 45 min and 8.7 GB, and
  `verdict.json` is written before `report.json`. Noted here; `run.sh` sets a 12 GB heap.
- **The least-squares baseline ran out of memory at the default heap.** It is re-run with
  `--max-old-space-size=8192`, now in `run.sh`.

## Round 2

Geometry, estimation and the red team, the three reviewers with major findings, re-read the
responses and the write-ups at 9e598ca.

| Reviewer | Verdict | Open |
| --- | --- | --- |
| TMA geometry | approve | 3 minor |
| Estimation and numerics | approve-with-findings | 3 minor |
| Red team | approve-with-findings | 2 minor |

M1–M4 are closed. Geometry checked every figure in the write-ups against its own medians, to all
printed digits. No reviewer rejects, and no blocker or major finding is open.

The minors were fixed as follows:
- **The mechanism is hedged.** The blog, §C.14 and the algorithm note now say that T2 "plausibly"
  or "likely" makes the tracker robust, call it a hypothesis, and say that k was not re-swept.
- **The frozen-reference qualifier** is in the blog's title and its one-line version.
- **The public limits** now list NIS, NEES and non-PD counts as not measured.
- **The blog** adds batch least squares on settled rows (course 8.1°, speed 1.8 kt) and the fused
  tracker's course P90 (106°).
- **`decided_by`** is set now that the round has approved.
