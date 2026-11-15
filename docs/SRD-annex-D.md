# SRD Annex D: the composite solver and gate G9

Nov 15, 2026 · annex to [SRD.md](SRD.md)

## D.0 Status and scope

Annex C is closed (§C.19), and the project's answer is recorded in SRD §1. Spec 024 then found:

- **On straight legs,** batch least squares reaches the Cramér–Rao bound, under white noise and
  under realistic bearing error. Every recursive tracker is 1.4–1.7 × above it in range.
- **After a manoeuvre,** least squares (which assumes constant velocity) is the worst estimator.
  The fused tracker and T2 are the best.

On 2026-11-15 the owner chose to build a **composite solver** that switches between the two by
situation. It is judged by a new gate, **G9**, that asks for the best of both, under realistic
bearing error. Nothing is trained. The composite combines frozen estimators and is a new
deliverable, not a change to any earlier verdict.

The owner's decisions (2026-11-15):

- **D1, the design:** switch by situation, with no training.
- **D2, the gate:** beat the fused tracker overall, and stay within 1.1 × of least squares on
  straight legs.
- **D3, the data:** realistic bearing error (the phase-7 ranges).
- **D4, the switch:** a least-squares fit check, with its threshold tuned on validation.

The rest of this annex was written by the implementing agent. It stands unless the owner amends
it before decision 41 is committed.

## D.1 The estimator

**Inputs:**

- **Batch least squares at every timestep** (`tma-solve --per-timestep`, the solver's default
  settings; estimator `classical`).
- **The frozen fused tracker** `fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-g1-k4-m6`:
  the `-g1` IMM with the frozen T2's range fused in (decision 35, §C.14).

**The fit check.** At each timestep i, take the least-squares solution at i and compute the
mean squared bearing residual of its constant-velocity track over the last W samples (dropped
samples excluded). Divide by σ², with σ floored at 0.1°. A constant-velocity target leaves only
noise in the residuals; a manoeuvre shows up as a growing misfit at the recent end of the window.

**The switch** (`compositePredict`, estimator name
`composite-classical-<fused>-w<W>-c<c>`):

- While the statistic is at or below the threshold c, the composite reports the least-squares
  row.
- At the first row where it exceeds c, the composite **switches to the fused tracker and stays
  there**. A constant-velocity fit over the whole window cannot recover after a real manoeuvre.
- A non-converged least-squares row is replaced by the fused tracker's row, without latching.

The composite is causal: every row uses bearings up to its own time.

## D.2 Validation and selection (before the gate decision)

- **Data.** Seed 217's validation split with the phase-7 ranges, the split phases 7–11 used,
  and its existing fused-tracker predictions (`experiments/20261114-p11-val/`).
- **The grid.** 24 variants: W ∈ {6, 12, 30, 60} samples (1, 2, 5 and 10 min) ×
  c ∈ {2, 3, 4, 6, 8, 12}.
- **The score.** For each variant, compute the five gated G9 point ratios (§D.3). Its score is
  the smallest margin, (limit − point) / limit.
- **The rule.** Pick the highest score. Among variants within 0.005 of it, prefer the larger c,
  then the larger W, because fewer switches mean fewer false alarms. The variant is carried
  only if its score is above 0. Otherwise this annex stops at validation.
- **Pre-registration.** The script (`scripts/research/spec025-grid.mjs`) and its `run.sh` are
  committed before any variant is scored.

## D.3 Gate G9

G9 is judged on G5's rows (σ = 1°, zig + 5/10/15/20 min) of a fresh test split with the phase-7
ranges. Each interval is a scenario-clustered paired bootstrap of the ratio of medians: 95%, with
2,000 resamples and seed 20261011. There is one carried estimator, and every gated check must
pass, so no multiplicity correction is applied.

| Check | Rows | Ratio | Limit |
| --- | --- | --- | --- |
| g9-range-vs-fused | all G5 rows | composite / fused tracker, median range error | wholly below 1 |
| g9-course-vs-fused | all G5 rows | composite / fused tracker, median course error | wholly below 1 |
| g9-straight-range | straight-leg rows | composite / least squares, median range error | wholly below 1.1 |
| g9-straight-course | straight-leg rows | composite / least squares, median course error | wholly below 1.1 |
| g9-straight-speed | straight-leg rows | composite / least squares, median speed error | wholly below 1.1 |

- **Straight-leg rows** are settled rows at which no target manoeuvre has started.
- **Speed against the fused tracker** is reported, not gated.
- **The verdict follows FR-015.** It passes if every gated check passes and fails if any check's
  lower bound is at or above its limit. Anything else is inconclusive.
- **Bindings** (`tma-g9`) are spec 015's:
  - the committed decision names the test seed, the plans, the composite as the carried
    estimator and the fused tracker as the reference;
  - the data postdate the decision;
  - the frozen T2 is bound by digest;
  - the composite's two inputs are the files given, byte for byte;
  - a seeded sample of 200 scenarios of the composite, the fused tracker and least squares is
    re-computed byte for byte;
  - each decision and seed is scored once.
- **Seeds.**
  - **Decision 41** fixes fresh seed 229: 400,000 scenarios, whose test split has 40,000.
  - **One re-score,** if the first result is inconclusive, uses seed 230: 1,100,000 scenarios,
    whose test split has 110,000. A fail or inconclusive there is final.
  - **False passes:** at most about 2.5% per check per look, and about 5% over both looks.

**Reported, not gated:**

- G5's checks against the `-g1` IMM;
- the EKF, T2 and naive;
- the share of rows taken from each input;
- the composite's error on rows after a manoeuvre.

## D.4 What follows

If G9 passes, the composite is the project's recommended estimator under realistic bearing
error, with the limits it states. If G9 fails, the owner decides what follows. Earlier verdicts
stand either way.

## D.5 Risks stated in advance

- **The fit check is blind to a slow manoeuvre.** A speed change of 0.05 kt/s, or a gentle turn,
  may not raise the residuals until the least-squares fit has already drifted. Rows near a
  manoeuvre may then be worse than both inputs.
- **False alarms are permanent.** Correlated bearing error and a drifting bias also raise the
  residuals. A latched false alarm gives up least squares' accuracy for the rest of the window.
  The threshold trades this off against the previous risk, and validation sets it.
- **Seed 217 has been used again.** This is the sixth selection on seed 217's validation split.
  The fresh test seed protects the verdict, not the choice of design.
- **Cost.** Least squares at every timestep takes about 0.2 s per scenario on one core, which is
  why `tma-solve --workers` was added.

## D.6 Outcome (2026-11-15): stopped at validation

`experiments/20261115-p12-val/validation.md`.

- **No variant is carried.** The best score is −0.0134 (W 6, c 8). The binding check is overall
  course against the fused tracker: 1.013 [0.993, 1.039].
- **The other gated checks pass on that variant:**
  - range against the fused tracker, 0.964;
  - straight-leg range, course and speed against least squares, 1.02 / 1.07 / 1.04.
- **Reported:** speed against the fused tracker is 0.85.
- **Why it fails.**
  - On straight legs the composite keeps least squares' accuracy, with course 4 × better than
    the fused tracker's.
  - After a manoeuvre it reports least squares' stale fit until the check trips. Course there is
    12% worse than the fused tracker's.
  - Most G5 rows come after a manoeuvre, so overall course misses.
  - The threshold only trades early false alarms against late detection.
- **Seeds.** 229–230 were never generated, and no G9 was scored. Earlier verdicts stand.
- **Next.** The owner decides.

## D.7 The re-armed composite (owner decisions 2026-11-15, after §D.6)

The owner chose to let the composite return to least squares on a new straight leg:

- **D5, the new-leg fit:** anchored to the fused tracker.
- **D6, the hand-back rule:** a mature leg that passes the fit check.
- **D7, the gate:** G9 unchanged, on seeds 229–230, which were never generated.

The rest of this section was written by the implementing agent.

- **The estimator** (`compositePredict` with `leg` and `priorSd`; name suffix `-l<L>-p<σ_p>`).
  Until the first switch it is §D.1's composite, row for row. After a switch at sample s, a leg
  starts at ℓ = s.
  - **While on the fused tracker:** once the leg holds L samples, a constant-velocity track is
    fitted to the bearings [ℓ, i]. Its weighted cost is Σ (r_j/σ)² plus
    ((log range at ℓ − the fused tracker's log range at ℓ)/σ_p)².
    - If the fit converges, is plausible and passes the same fit check (W, c), the composite
      reports it and stays on the leg.
    - If it converges and fails the check, ℓ advances by W samples. The leg's start was probably
      still inside the manoeuvre.
  - **While on a leg:** a failed check returns to the fused tracker and starts a new leg there.
    A non-converged or implausible fit gives the fused row.
  - **The anchor's role.** It supplies range, which the new leg's bearings alone rarely
    determine without another ownship manoeuvre.
- **What it can and cannot fix.**
  - It helps rows long after a manoeuvre, where the fused tracker lags least squares' accuracy
    (§D.6: course 4 × worse on straight legs).
  - It does not shorten the detection delay that cost §D.1's design G9. A pass is not assured.
- **Validation and selection.**
  - **Data:** seed 217 again, its seventh selection.
  - **The grid:** §D.6's four best (W, c) pairs (6, 8), (60, 3), (30, 4) and (12, 6), × L ∈
    {18, 36, 60} samples (3, 6 and 10 min) × σ_p ∈ {0.1, 0.2}: 24 variants. Restricting to those
    pairs is itself a choice made on §D.6's results.
  - **The score and rule** are §D.2's. Ties go to the larger c, then the larger W, the larger L
    and the larger σ_p.
  - **Pre-registration.** The script (`scripts/research/spec025-rearm-grid.mjs`) and `run.sh`
    (`experiments/20261115-p12b-val/`) are committed before any variant is scored.
- **The gate** is §D.3's G9, unchanged. Decision 41 is committed only if a variant is carried,
  and only then is seed 229 generated.

