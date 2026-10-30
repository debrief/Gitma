# Learned-gain filter (tracker T1)

Source: `packages/models/src/filter-layer.ts` (`LearnedGainFilter`), model kind
`learned_gain_filter`. Requirements: SRD Annex C §C.4, spec 012 FR-004, constitution 1.3.0
principle III (a declared filter layer).

Phase 4's first tracker keeps the physics of a tracking filter and learns only how hard to trust
each bearing. It follows KalmanNet (Revach et al. 2022):
- **Explicit physics.** The constant-velocity prediction and the bearings-only update are written
  out.
- **A learned gain.** A recurrent network computes the gain each step from what the filter has
  just seen, in place of a covariance.
- **Training.** It is trained end to end through the recursion.

## Inputs and units

The layer reads the raw feature set (10 channels): bearing sin and cos, ownship x and y, ownship
course and speed, time, the valid flag and the window mask. All in the features' scaled units:
positions are divided by `position_scale_km`, time by `time_scale_s`. The filter state lives in
those units.

## The recursion

State per scenario: position **p** and velocity **v** (2 each), a started flag, the previous time,
and the GRU state **h**. At each row k:

| Step | Equation |
| --- | --- |
| Time step | τ = (t_k − t_prev) · window_k (zero on padding and before the first bearing) |
| Prediction | p⁻ = p + v τ, v⁻ = v |
| Predicted bearing | d = p⁻ − o_k, r = √(\|d\|² + ε²), (s_b, c_b) = d / r |
| Innovation | ν = atan2(s_z c_b − c_z s_b, c_z c_b + s_z s_b) · valid (wrapped to (−π, π]) |
| Gain features | f = [ν·valid, valid, log r, τ, v⁻] |
| GRU | z = σ(W_z f + U_z h + b_z), g = σ(W_r f + U_r h + b_r), ĥ = tanh(W_h f + U_h (g ⊙ h) + b_h), h ← (1 − z) ⊙ h + z ⊙ ĥ |
| Gain | K = κ tanh(W_K h + b_K), four components (p_x, p_y, v_x, v_y) |
| Update | p = p⁻ + K_p ν, v = v⁻ + K_v ν |
| First bearing | p = o_k + R₀ (s_z, c_z), v = 0, with R₀ = e^ρ trainable |
| Bounds | p clipped to ±10 and v to ±5 scaled units (about 30 m/s) |

Output per row, in the velocity parameterisation: [log r_p + λ, α v_x, α v_y, 0], with r_p the
range from ownship to p. λ maps scaled range to log km and α maps scaled velocity to
v / `velocity_scale_mps`. Both are trainable, and the loss is phase 3's velocity loss.

Choices made for training stability, each of which changes nothing in the filter's equations:
- **Gain bound κ = 1.** Initial gains are near zero, so an untrained filter coasts on its
  prediction instead of diverging.
- **Offset before the first bearing.** Before the first bearing, d is offset one unit north, so
  that atan2 and the square root stay differentiable.
- **Rows without a bearing.** On those rows the predicted bearing stands in for the measured one,
  so ν = 0 with finite gradients. atan2(0, 0) would otherwise make every gradient NaN.

## Known answer

With the EKF's own gains injected in place of the GRU's (K = P hᵀ / (h P hᵀ + σ²), converted to
scaled units), the layer reproduces the EKF on a phase-4 scenario with dropouts. Its position is
within 0.1% of range over 120 steps (`packages/models/test/filter-layer.test.ts`). That one test
checks the prediction, the wrapped innovation, the update, dropouts and the unit conversions
together.

## Porting

The layer uses only matrix products, elementwise maths and atan2, so a Keras custom layer can
implement it from the table above. Its weights are the GRU's (W, U and b for z, r and h), W_K, b_K,
ρ, λ and α. Training cost, measured on 4 cores shared with other work: about 4.5 s per batch of 64
windows × 360 rows, against 5.7 s for a 2 × 128 LSTM with the Gaussian head.
