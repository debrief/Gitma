# Phase 5 validation: manoeuvre detection (spec 017; SRD Annex C §C.12)

**Result: phase 5 stops at validation.** The learned detector is not carried to a test split.

- **Why it stops.** At the declared operating point it detects fewer course changes within 5 min
  than the CUSUM, by 9 points.
- **What this means for seed 215.** No decision record pre-registers a test split. Seed 215 was
  never generated and remains free.
- **What next.** The owner decides the follow-on (§C.12; C.6 items 2 and 3 remain).

**The data.** Seed-211 validation: 4,951 σ = 1° scenarios, 7,479 target course changes and 896.6
quiet hours. Regenerated from a clean tree at `ff585f3`, with plan digests checked.

**The detectors.**
- **Reference:** the decision-32 IMM, `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1`.
- **Learned:** the frozen T2, `experiments/20261101-p4b-models` (decision 30's digests).
- **Run:** `run.sh`.

## At the declared operating point, 0.5 false alarms per quiet hour

| Detector | Threshold | Detected within 5 min | Missed in 10 min |
| --- | --- | --- | --- |
| **CUSUM, mean shift, c 0.5, clip 3 (best reference)** | 0.920 | **28.2%** | 71.1% |
| CUSUM, mean shift, c 0.25 | 3.41 | 25.4% | 73.6% |
| CUSUM, NIS, c 0.5, clip 5 | 1.04 | 22.7% | 76.3% |
| CUSUM, other settings (9 more) | | 18.3–22.4% | 76.7–80.7% |
| **Learned: T2's course change over 1 min (best learned)** | 78.1° | **19.2%** | 79.4% |
| Learned: T2 against the IMM, course disagreement | 166° | 5.9% | 92.6% |

The full table is in `validation/calibration.json`.

**The G6 checks, best learned against best CUSUM** (`validation/diagnostic.json`, 95%
scenario-clustered intervals):

| Check | Value | Limit | Result |
| --- | --- | --- | --- |
| G6-delay | undefined: both detectors miss more than half the events, so both medians are +∞ | < 1 | inconclusive |
| G6-detect5 | −8.95 pp [−10.16, −7.73] | lower bound ≥ −2 pp | **fail** |
| G6-false-alarms | 1.000 [0.835, 1.189] | upper bound ≤ 1.25 | pass |

**The validation rule** (as C.5 and Annex A B.3 rule 3): carry only if every check's point
estimate meets its limit and no interval lies wholly beyond it. G6-detect5's interval lies
wholly beyond its margin, so the detector is not carried.

## Reported, not gated: other operating points (`sensitivity.json`)

| False alarms per quiet hour | 0.5 | 1 | 2 | 5 |
| --- | --- | --- | --- | --- |
| Learned (course change over 1 min), detected within 5 min | 19.2% | 39.0% | 58.1% | 71.7% |
| Best CUSUM (mean shift, c 0.5), detected within 5 min | 28.2% | 38.0% | 47.8% | 62.6% |
| Learned, median delay among detected | 150 s | 130 s | 130 s | 110 s |
| CUSUM, median delay among detected | 110 s | 110 s | 110 s | 100 s |

- **There is a crossover.** From about 1 false alarm per hour, the learned detector catches more
  course changes within 5 min. Among the events both catch, it is 20–40 s later.
- **The operating point stays as declared.** The owner chose matched false alarms, with the
  question's example of 1 per 2 h. Moving it after seeing these figures would choose the rule from
  the result, so the crossover is reported, not used.
- **10 per hour is not shown.** No threshold reaches it: calibration falls to 0 and every row
  alarms, which is an artefact.

## Lessons for any further attempt

1. **G6-delay as pinned cannot be judged at a strict operating point.** With more than half the
   events missed, both medians are +∞. Any later gate should use the delay among events both
   detectors catch, or a lower quantile, declared in advance.
2. **The reference's innovations carry a weak, heavy-tailed signal.** On quiet rows the NIS
   median is 0.06 and its mean 0.83, with 0.2% above 10. The clipped mean-shift CUSUM is the
   better baseline. An unclipped CUSUM was unusable: its statistic averaged about 480 around turns.
3. **Disagreement with the IMM is a poor detector.** It peaks after the IMM has already turned,
   and T2's own course change is better at every rate.
