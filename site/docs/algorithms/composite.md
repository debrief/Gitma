# Composite solver

Source: `packages/classical/src/composite.ts`, `packages/eval/src/cli-composite.ts`; gate
`packages/eval/src/gate-g9.ts`. Requirements: SRD Annex D, spec 025.

## Why

Spec 024 measured both inputs against the Cramér–Rao bound under realistic bearing error:

- **Before any target manoeuvre,** batch least squares reaches the bound. The fused tracker is
  1.4 × above it in range, and 4 × in course.
- **After a manoeuvre,** least squares is the worst estimator, because it assumes constant
  velocity. The fused tracker and T2 are the best.

The composite reports least squares while its constant-velocity fit holds, and the fused tracker
after that.

## Inputs

- **`classical`:** batch least squares at every timestep (`tma-solve --per-timestep`), fitted to
  every bearing from the window start.
- **The fused tracker:** the `-g1` IMM with T2's range fused in (see the fused-tracker note).

## The fit check

At sample i, the least-squares row gives the position `p_i` and velocity `v`. The statistic is the
mean squared residual over the valid samples j in (i − W, i]:

`S_i = mean_j angleDiff(b_j, bearing(p_i + v·(t_j − t_i) − o_j))² / max(σ, 0.1°)²`

Here `o_j` is ownship and σ is the scenario's white-noise sd. With a constant-velocity target, `S`
stays near the noise level. With correlated error it sits above 1. After a manoeuvre, the recent
bearings depart from the fitted track and `S` grows.

## The switch

| Situation at row i | Row reported |
| --- | --- |
| Already switched | Fused tracker (the switch latches) |
| Least squares not converged, or no valid bearing in the window | Fused tracker, without latching |
| `S_i > c` | Fused tracker, and switch from here on |
| Otherwise | Least squares |

W and c are part of the estimator's name, `composite-classical-<fused>-w<W>-c<c>`. They are chosen
on validation by a pre-registered rule (Annex D §D.2).

## Gate G9

On G5's rows under realistic error, with 95% scenario-clustered intervals:

- **All rows:** median range and course error wholly below the fused tracker's.
- **Straight-leg rows** (settled, no manoeuvre started): median range, course and speed error
  wholly within 1.1 × of least squares.

## Known limits

- **Slow manoeuvres** may not raise `S` before least squares has drifted.
- **False alarms latch.** After one, least squares is lost for the rest of the window.
- **Cost.** Least squares at every timestep costs about 0.2 s per scenario on one core
  (`tma-solve --workers n`).
