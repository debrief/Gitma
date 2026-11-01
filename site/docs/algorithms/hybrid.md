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

## The tracker hybrid (phase 4b, spec 013)

Source: `trackerHybrid` in `packages/classical/src/hybrid.ts`; CLI `tma-hybrid-track`.
Requirements: SRD Annex C §C.10 (owner decision 30).

Phase 4's recurrent tracker T2 beats the tuned IMM on range overall and on velocity after a
manoeuvre, but loses on velocity on straight segments (and on range before any manoeuvre). The tracker hybrid keeps each one's strength:

- **Range** is always T2's.
- **Course and speed** are T2's only where the two estimators' courses differ by more than
  θ = 45°; elsewhere they are the IMM's. The IMM lags a manoeuvre, so a large disagreement means a
  manoeuvre is in progress or recent.
- **Causal.** The rule reads only both estimators' outputs at the same row.
- **θ** was chosen on seed-211 validation by a criterion declared in advance (the largest smallest
  margin over G5's five checks) and frozen; it is part of the estimator name
  (`hybrid-<network>-<tracker>-c45`).
- **Uncertainty.** The hybrid keeps T2's stated range sd; its velocity sd is reported only where
  T2's velocity is used.

On validation (in-sample) it is 0.85 × the IMM on overall range and 0.90 × on course, and
0.97–0.99 × on settled range, course and speed (spec 013 R2). It passed G5 on fresh seed 213
(`experiments/20261101-p4h-g5/`).

**Provenance (schema 0.17.0).** A network's prediction file names the SHA-256 of the weights it was
made with (`model_weights_sha256`), and the hybrid's file names the SHA-256 of both input files
(`inputs`). On a test split, `tma-g5` refuses a carried file unless it traces to a `--model`'s
weights, directly or through inputs that are, byte for byte, files given to the gate.

**Not one track state.** Range (with position) comes from T2 and velocity mostly from the IMM, so the
bearing rate they imply is neither estimator's. On seed 213's G5 rows (`bearing-rate.json`, from
`scripts/research/spec013-bearing-rate.mjs`), the error of the implied bearing rate against truth
is a median of 0.24°/min for the hybrid, against 0.20 for the IMM and 0.23 for T2. On settled rows
it is 0.13, against 0.10 and 0.14. Propagated 5 min at constant velocity, the hybrid's settled
bearing is off by a median of 1.5°, against 1.0° for the IMM, 0.9° for the EKF and 1.6° for T2.
Mixing the two estimators adds little inconsistency beyond T2's own. On settled rows, though, its
state is less consistent with the bearings than either tracker's.
