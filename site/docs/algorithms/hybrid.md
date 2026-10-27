# Hybrid estimator (classical with a network fallback)

Source: `packages/classical/src/hybrid.ts` (`hybridSwitch`), CLIs `tma-hybrid` and `tma-g3`
(`packages/eval`). Requirements: SRD §5 (G3), Annex A lever B.2.6, spec 009.

## Why a hybrid

After G2, the models were 2.1–3.5 × the [least-squares solver](least-squares-solver.md) on range,
course and speed. They made fewer gross errors early in the track. Spec 009's research looked at
how the two could be combined:

- **Starting the solver from the network changes almost nothing.** It reproduces classical in all
  but 0.13% of rows.
- **Classical's gross errors are not convergence failures.** They are the least-squares optimum
  itself lying far from the truth. On seed 205's validation split, the true state had the lower
  cost in 1 of 2,379 gross rows.
- **The network is still right there.** Its range was within 50% of the truth in 91% of those
  rows.

So the hybrid keeps classical's estimate and uses the network only where the two disagree.

## Rule

At each timestep after the zig, with classical row `c` and network row `n` (both causal):

- **Classical failed:** use `n` if `c` did not converge or is implausible (classical then
  reports `converged = false`).
- **Large disagreement:** use `n` if `|r_c − r_n| / r_n > 0.5`, where `0.5` is
  `SWITCH_RANGE_REL`, the same bound as a gross error.
- **Otherwise:** use `c`.

The network is the frozen iteration-4 instantaneous LSTM. The rule has no fitted parameters.

## What it claims

It is a **hybrid result**, not "a network alone":
- its accuracy is classical's;
- its contribution is a lower gross-error rate where least squares lands far from the truth.

G3 (SRD §5) is judged for it against classical by `tma-g3`, on the σ = 1° slice, with paired
bootstrap 95% intervals and FR-015:
- the median and P90 ratios of range and course error at zig + 300 s, and of speed error at
  zig + 600 s, against 1.2;
- the gross-error-rate difference at zig + 300 s, against 0.
