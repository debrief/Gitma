# Interim: T1 validation diagnostic (seed-211 validation)

Scratch output of `tma-g5` for T1 alone, kept until T2 finishes and both trackers are scored together
into `experiments/20261031-p4-val/`. The validation rule (decision 29) is applied there.

- **Model.** `results/p4a-41194775176` (weights SHA-256 5031a2e1…, epoch 67 of 74, early stopping).
- **Reference.** `imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8`; the EKF `ekf-sa0.03-p4-r8` is reported beside it.
- **Data.** Train and validation content digests match `configs/phase4/a/plan.json`.
- **Headline.** T1's median range error is 20.1% against the IMM's 9.2%, and it stays at 19–22% from
  zig + 5 to zig + 20 min: T1 does not converge in range.
