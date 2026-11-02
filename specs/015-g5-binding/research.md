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

- **Seed 214 test split:** PHASE4C_GUARD rows of T2 would be skipped.
- **The fused verdict.** It re-scores with identical checks under the guarded code (R6), so the
  guards change nothing that was scored.

## R5 The reference IMM's CV covariance (report only; the frozen IMM is unchanged)

PHASE4C_PD

## R6 Regression

| Phase | Data | Re-computed (200 scenarios, byte-identical) | `checks` vs committed | Tampered cases refused |
| --- | --- | --- | --- | --- |
| 4b, seed 213 | regenerated at `4a15ba4` from a clean worktree; plan digests checked | hybrid θ 45° (with its IMM input re-run), reference IMM | identical, 7 checks, pass | C, A, B, D |
| 4c, seed 214 | PHASE4C_DATA | PHASE4C_RECOMPUTED | PHASE4C_CHECKS | PHASE4C_TAMPER |

**Tampered cases:**
- **A.** Another setting under the frozen name. For 4b, the hybrid at θ 30° renamed c45; for 4c,
  the fused tracker at k 2 renamed k4.
- **B.** One row of a sampled scenario changed by 1 m.
- **C.** A second scoring without `--repeat-of`.
- **D.** The data header names the commit before the decision (`requireG5Binding` on a copy).

All refused with the expected message; the logs are in the PR description.
