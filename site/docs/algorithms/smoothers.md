---
title: Classical smoothers (spec 032)
---

# Classical smoothers

Time-late classical references for Annex J: each estimate uses every bearing of the window.

## EKF RTS smoother

The EKF's forward pass (initialisation, re-initialisation and plausibility unchanged) records each
step's filtered moments x_f, P_f and the prediction x_p, P_p into the next step. Backward over each
run of consecutive plausible steps:

x_s(k) = x_f(k) + G (x_s(k+1) − x_p(k+1)),  G = P_f(k) Fᵀ P_p(k+1)⁻¹.

The last step's smoothed estimate is its filtered one.

## IMM smoother

The IMM's forward pass records, for each model j, the mixed prior x̄_j(k), P̄_j(k) it was predicted
from and the prediction x_p,j(k+1), P_p,j(k+1). Backward, each model takes an exact RTS step through
that recursion,

x̄_j(k|N) = x̄_j(k) + P̄_j(k) F_jᵀ P_p,j(k+1)⁻¹ (x_j(k+1|N) − x_p,j(k+1)),

and the model-conditioned estimates are x_i(k|N) = x_i(k) + Σ_j w_j|i (x̄_j(k|N) − x̄_j(k)), with
w_j|i ∝ π_ij μ_j(k+1|N) / c_j. The smoothed model probabilities are Kim's,
μ_i(k|N) = μ_i(k) Σ_j π_ij μ_j(k+1|N) / c_j, where c_j = Σ_i π_ij μ_i(k). The reported estimate is
Σ_i μ_i(k|N) x_i(k|N). Without switching it is each model's RTS smoother.

## Known behaviour

With a constant-velocity model, smoothing across a later target turn drags the earlier straight leg
toward the post-turn bearings, and a drifting bearing bias does not average out; the smoothers are
therefore tuned for smoothing, not with the forward trackers' settings.
