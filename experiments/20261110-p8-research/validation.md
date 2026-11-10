# Phase 8 validation: the fusion re-tuned for correlated error (spec 020, SRD Annex C §C.15)

**Result: no variant is carried, so phase 8 stops at validation.** Seed 220 is never generated,
and no G8 is scored.

**Data.** Seed 217's 10,000-scenario validation split with realistic bearing error
(`configs/phase7-ranges.json`, generated clean at 14eeb1a). That gives 16,711 G5 rows, of which
7,509 are settled.

**Grid.** k ∈ {0.5, 1, 1.5, 2, 3, 4} × M ∈ {1, 3, 6, 12}, each on the frozen `-g1` IMM with frozen
T2.

**Pre-registration.** The selection and its script (`scripts/research/spec020-grid.mjs`, 14eeb1a)
and `run.sh` were committed before any variant was scored. Results are in `grid.json` and hashes
in `predictions.sha256`.

## The grid: point ratios of medians

The first five columns are fused / `-g1` IMM; the "/ T2" column is fused / T2 range. The score is
the smallest margin, (limit − point) / limit.

| k | M | Range | Course | Settled range | Settled course | Settled speed | Range / T2 | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.5 | 1 | 0.749 | 1.113 | 0.810 | 1.266 | 1.218 | 1.027 | −0.151 |
| 0.5 | 3 | 0.758 | 1.078 | 0.812 | 1.154 | 1.120 | 1.039 | −0.078 |
| 0.5 | 6 | 0.769 | 1.031 | 0.817 | 1.074 | 1.084 | 1.053 | −0.053 |
| 0.5 | 12 | 0.771 | 1.000 | 0.820 | 1.037 | 1.059 | 1.056 | −0.056 |
| 1 | 1 | 0.750 | 1.032 | 0.803 | 1.112 | 1.078 | 1.028 | −0.033 |
| 1 | 3 | 0.749 | 0.975 | 0.795 | 0.984 | 0.996 | 1.026 | −0.026 |
| 1 | 6 | 0.757 | 0.944 | 0.802 | 0.928 | 0.965 | 1.038 | −0.038 |
| 1 | 12 | 0.756 | 0.929 | 0.800 | 0.923 | 0.940 | 1.037 | −0.037 |
| 1.5 | 1 | 0.744 | 0.978 | 0.796 | 1.016 | 1.012 | 1.020 | −0.020 |
| 1.5 | 3 | 0.746 | 0.935 | 0.790 | 0.935 | 0.946 | 1.023 | −0.023 |
| 1.5 | 6 | 0.754 | 0.918 | 0.792 | 0.890 | 0.915 | 1.034 | −0.034 |
| 1.5 | 12 | 0.756 | 0.915 | 0.782 | 0.893 | 0.915 | 1.036 | −0.036 |
| 2 | 1 | 0.742 | 0.956 | 0.790 | 0.979 | 0.972 | 1.017 | −0.017 |
| 2 | 3 | 0.747 | 0.919 | 0.787 | 0.897 | 0.924 | 1.023 | −0.023 |
| 2 | 6 | 0.753 | 0.908 | 0.786 | 0.887 | 0.909 | 1.032 | −0.032 |
| 2 | 12 | 0.756 | 0.918 | 0.773 | 0.870 | 0.896 | 1.036 | −0.036 |
| **3** | **1** | 0.740 | 0.918 | 0.781 | 0.903 | 0.924 | **1.014** | **−0.014** |
| 3 | 3 | 0.748 | 0.904 | 0.772 | 0.869 | 0.900 | 1.024 | −0.025 |
| 3 | 6 | 0.757 | 0.914 | 0.761 | 0.858 | 0.882 | 1.038 | −0.038 |
| 3 | 12 | 0.780 | 0.925 | 0.781 | 0.877 | 0.897 | 1.069 | −0.069 |
| 4 | 1 | 0.741 | 0.910 | 0.777 | 0.890 | 0.900 | 1.015 | −0.016 |
| 4 | 3 | 0.749 | 0.906 | 0.757 | 0.858 | 0.885 | 1.027 | −0.027 |
| 4 | 6 (frozen, phase 7) | 0.777 | 0.922 | 0.778 | 0.876 | 0.889 | 1.064 | −0.064 |
| 4 | 12 | 0.808 | 0.941 | 0.804 | 0.911 | 0.902 | 1.107 | −0.107 |

**The rule's choice.**
- The best score is −0.0139, at k 3, M 1.
- The tie rule (within 0.005, then the larger k) selects k 4, M 1, at −0.0155.
- Both are below 0, so nothing is carried.
- In the six best variants the binding check is always fused / T2 range.
- The k 4, M 6 row reproduces phase 7's validation figures exactly.

## Reading

- **No setting of k and M brings the fused tracker's range below T2's under this error.** The
  closest is 1.4% worse (k 3, M 1).
  - The update interval matters more than the weight: M = 1 is best at every k.
  - Weighting T2 more heavily (smaller k) does not help. At k 0.5 the range is still 2.7–5.6%
    worse than T2's, and course and settled velocity collapse (course up to 1.11 × the IMM's,
    settled course up to 1.27 ×).
  - A plausible reason, not tested here: each bearing update pulls the IMM's range back towards
    its biased estimate (about −7% under the drifting bias, phase 7), so the fused state cannot
    hold T2's range.
- **Re-tuning does improve the fused tracker against the IMM.** At k 3, M 1, range is 0.740
  against the frozen setting's 0.777, and fused/T2 is 1.014 against 1.064. But the rule required
  beating T2, and that was not met.
- **Limits.** This is one error model at one severity, on validation only. It is a single grid,
  in-sample, which favours finding a winner, and none was found.

**Next: the owner decides.** Within the fusion, the remaining options are:
- a bias state in the IMM;
- feeding T2's range with less filter interaction, for example as the reported range, as the
  phase-4b hybrid did.

Phase 7's verdict stands.
