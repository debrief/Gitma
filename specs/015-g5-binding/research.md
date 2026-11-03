# Spec 015 research

## R1 Settings from names, not new header fields

Every tracker's estimator name is a pure function of its settings (`immName`, `ekfName`,
`fusedName`, `trackerHybridName`). The decisions freeze those names (`reference_estimator`,
`carried_models`), and `tma-g5` already requires the files' names to equal them.

Parsing the name, and accepting it only if the parsed settings give back the same name, binds the
settings to the decision with no new header fields. Prediction rows and writers stay unchanged, and
a name that is ambiguous or non-canonical is refused rather than read loosely (`names.test.ts`).
Structured header fields would have needed a second check that they agree with the name.

The schema still moves to 0.18.0, for the `scoring.json` record (R3).

## R2 Sample and cost

- **The sample.** 200 scenarios, drawn without replacement (partial Fisher–Yates, `createRng`,
  seed 20261011) from the scenarios that have G5 rows, then sorted.
- **Inputs.** The fused tracker's and the hybrid's inputs are resolved among the files given, by
  estimator and SHA-256, the same rule as the prediction chain. A classical input is itself
  re-computed: for the hybrid, the IMM it was built from is re-run, not read.
- **Cost.** About 5 s per estimator, against about 8 min for the verdict.
- **What a sample catches.** A file whose settings differ from its name differs on almost every
  scenario, so 200 scenarios catch it. A hand edit confined to unsampled scenarios is not caught.
  The sample is fixed by the gate's seed, so it is known in advance. The byte-identical
  regeneration that each `run.sh` records still covers the full file.

## R3 Scored once across experiments

`verdict.json` records neither the decision nor the seed, and the committed verdicts must not
change. So the gate writes `scoring.json` (`GateScoring`) beside the verdict, and scans
`experiments/*/` for it.

- **The match.** The same seed and the same decision, by path or by SHA-256. A copied decision is
  still the same decision.
- **A G5 verdict without `scoring.json` refuses.** Without it, the scan cannot tell what that
  verdict scored. The two committed G5 experiments were backfilled with their decision, digest,
  seed and the truth digest from their `predictions.sha256`.
- **`--repeat-of`** names a reproduction, and the reproduction's `scoring.json` records it. C.5's
  one re-score is on a fresh, larger seed, so it never collides with this check.

## R4 Fused-tracker guards on scored rows

`usableRange` refuses a range that is ≤ 0 or not finite, and a log-range sd that is absent, ≤ 0
or not finite.

- **Seed 214 test split.** Of T2's 4,938,978 rows (all converged), 0 would be skipped: no
  range ≤ 0 or non-finite, and no absent, non-positive or non-finite sd
  (`guards.mjs` count, logged in the PR).
- **The fused verdict.** It re-scores with identical checks under the guarded code (R6), so the
  guards change nothing that was scored.

## R5 The reference IMM's CV covariance (report only; the frozen IMM is unchanged)

**Reproduced.** The case is seed 214, scenario 360417, three target course changes (samples
124–129, 152–158, 189–195). Script: `scripts/research/spec015-imm-covariance.mjs` (`count`, `batch`).

- **On the plain reference IMM path, nothing fails** in this scenario. Every model covariance
  passes a Cholesky test at every stage (mix, predict, bearing update).
- **On the fused path, the CV covariance is not positive definite** at sample 152, before the
  range update, as the panel saw. It first fails at the *mix* stage at samples 145, 149, 152, 155
  and 158. There the CV and CT covariances are identical, with ω variance exactly 0.05²: these
  are re-initialisations (`immInitialise`) after an implausible estimate. The negative eigenvalue
  (−3.6 × 10⁻³ to −3.6 × 10⁻², against a largest eigenvalue of 10⁴–10⁵) survives prediction and
  the Joseph-form updates. Q only adds to velocity and the update cannot repair it. At 158 the
  condition number reaches 10¹⁴.

**Cause.** `ekfInitialise` sets P₀ = p0Scale · σ² (JᵀJ)⁻¹ at the batch least-squares solution
over all samples up to i, then propagates it to tᵢ.

- **The fit is wrong.** After the target's manoeuvres the constant-velocity batch fit is badly
  wrong: 5.1–15.9 km against a true range of about 2.0–2.2 km at samples 144–157.
- **The fit is degenerate.** The fitted straight track passes through ownship's position at
  sample 0: its closest approach is 1.6 × 10⁻⁸ to 9.4 × 10⁻⁸ m. That is a degenerate minimum
  of the bearings-only fit: at zero range one sample's bearing residual is undefined.
- **One sample dominates JᵀJ.** At that sample ρ² ≈ 0, so the Jacobian row ∝ 1/ρ dominates
  JᵀJ. Its largest eigenvalue is 10⁹–10¹⁵ and its smallest 10⁻³ or negative: a condition number
  of about 10¹⁶, at machine precision.
- **The plausibility check misses it.** `plausibleState` tests only the range at tᵢ (5–16 km
  here), not along the fitted track.
- **The inverse is indefinite.** JᵀJ is then computed indefinite. `inverse4` refuses only an
  exactly zero pivot, so it returns an indefinite (JᵀJ)⁻¹.
- **Propagation is not the cause.** Re-deriving the same covariance with the fit parameterised
  at tᵢ is just as bad; the conditioning of JᵀJ is the cause.

**How often (seed 214 test split, plain reference IMM, `immPredict` unchanged):**

- **Overall.** 87 of 44,343 initialisations are not positive definite: 3 of 33,849 first
  initialisations and 84 of 10,494 re-initialisations.
- **Scenarios.** 43 of the 40,000 scenarios (0.11%) carry such a covariance at some stage
  (mix, predict or update), counted with an instrumented copy.
- **After a full step.** In 17 of them it is still not positive definite after the update, as
  `onStep` sees it (`spec015-imm-covariance.mjs count`). Scenario 360417 is not among the 17: there
  it occurs only on the fused path, whose range updates change when the IMM re-initialises.
- **Rows.** The rows still come out finite; a non-PD state then usually becomes implausible and
  re-initialises again. The verdicts use only the reported rows, which re-score identically (R6).

**Proposed fix (not applied: the reference is frozen by decisions 29–31).** Any change alters the
reference's rows, so it needs a new decision and a re-tune before it could be used.

1. **Refuse a degenerate initialisation.** In `ekfInitialise`, return null (retry after
   `EKF_REINIT_EVERY` samples) in either of two cases:
   - the fitted track comes closer to ownship than the generator's `min_range_m` (100 m) at any
     fitted sample;
   - JᵀJ fails a Cholesky test.

   Then compute P₀ from a Cholesky or QR factor of the whitened Jacobian instead of `inverse4`
   (square-root form, about twice the precision).
2. **Re-initialise from recent bearings only.** Use a window since the IMM's last high-CT
   probability, or a fixed number of samples, rather than a constant-velocity fit through the
   manoeuvres. That removes the wrong fit that causes the near-pass.
3. **Assert, cheaply.** In `immStep`, add a Cholesky check after mixing as a diagnostic (G0 could
   count failures, as `tracker-nis` does).

## R6 Regression

| Phase | Data | Re-computed (200 scenarios, byte-identical) | `checks` vs committed | Tampered cases refused |
| --- | --- | --- | --- | --- |
| 4b, seed 213 | regenerated at `4a15ba4` from a clean worktree; plan digests checked | hybrid θ 45° (with its IMM input re-run), reference IMM | identical, 7 checks, pass | C, A, B, D |
| 4c, seed 214 | regenerated at `4a15ba4` from a clean worktree; plan digests checked; fused and hybrid rebuilt with the guarded code | fused k 4, M 6 (T2 rows as stored), reference IMM | identical, 7 checks, pass; `report.json` identical (378 rows) | C, A, B, D |

**Tampered cases:**
- **A.** Another setting under the frozen name. For 4b, the hybrid at θ 30° renamed c45; for 4c,
  the fused tracker at k 2 renamed k4.
- **B.** One row of a sampled scenario changed by 1 m.
- **C.** A second scoring without `--repeat-of`.
- **D.** The data header names the commit before the decision (`requireG5Binding` on a copy).

All refused with the expected message; the logs are in the PR description. For phase 4b,
`report.json` was not compared: the container restarted while it was being written. The verdict and
`scoring.json` had already been written.
