# Spec 014 research (validation only, seed 211)

The full record is in `experiments/20261102-fused-research/research.md` (grid, medians, NEES).

- **R1 Design.** The IMM plus T2's log-range at T2's stated sd × k, every M samples. The model
  probabilities are left to the bearings.
- **R2 Settings.**
  - 18 variants, in two adaptive stages, with k ∈ {1, 2, 4, 8, 16, 32} and M ∈ {1, 3, 6, 12, 30}.
    Decision 31 says 12; that was wrong, and the correction was made after the decision (G5 panel
    round 1).
  - The smallest G5 margin is 0.056–0.075 for k = 4 with M from 1 to 12, and for k8 M3. An earlier
    claim of a plateau in u = M·k² was wrong (k2 M30, u = 120, has 0.049).
  - k = 4, M = 6 is in the middle of that region, not its argmax (k4 M3 has 0.075). On validation
    its margin is 0.070.
  - Its ratios to the IMM: overall range 0.806, overall course 0.930; settled range 0.845, course
    0.908, speed 0.882.
  - Before any manoeuvre its range is 0.937 ×, against the hybrid's 1.347 ×.
- **R3 Consistency.** NEES mean 70, median 1.12, 94% within the 95% bound. For the IMM these are
  94, 0.99 and 92.5%. The fusion does not make the covariance less honest, but neither filter's
  covariance is calibrated.
- **R4 Implementation equivalence.** `tma-fuse-track` on the full validation split, scored by
  `tma-g5` as a diagnostic, reproduces R2's ratios (see the decision record).
