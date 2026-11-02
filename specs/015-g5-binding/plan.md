# Plan: Spec 015 — tighten the G5 gate's bindings

## Constitution check (1.3.0)

- **I Types.** One new LinkML class, `GateScoring` with `GateRecomputation` (schema 0.18.0).
  Generated with `pnpm schema:gen`; no hand-written record types.
- **II Determinism.** The sample is drawn with the seeded PRNG (`createRng`, seed 20261011).
  Re-computation uses the same pure functions that made the files. Golden files change only in the
  schema version string (0.17.0 → 0.18.0).
- **III Portability.** No model or feature changes. `fusedPredict` stays a pure function.
- **IV Baselines.** No new result. The regression re-scores the committed G5 runs with every
  reported estimator beside them, as in their `run.sh`.
- **V Gates.** No gate is judged. The committed verdicts are re-scored as reproductions
  (`--repeat-of`), and their `checks` must be identical.

## Design

| Gap | Where | Mechanism |
| --- | --- | --- |
| Parameters trusted from names (FR-001) | `@tma/classical` `names.ts`; `@tma/eval` `recompute.ts`; `prediction-file.ts` `rawPredictionLine` | Parse the name and require the round trip. Re-run 200 seeded scenarios and compare stored lines byte for byte. |
| Data postdate the decision (FR-002) | `requireG5Binding` | `deps.precedes(decision, generator_git_commit)`, before the frozen-model early return. |
| Scored once across experiments (FR-003) | `requireScoredOnce`, `priorG5Scorings`; `scoring.json` | Scan `experiments/*/` for G5 verdicts. Refuse on the same decision (path or SHA-256) and seed, unless `--repeat-of` names that experiment. |
| `fusedPredict` guards (FR-004) | `fused.ts` `usableRange` | Skip a row with range ≤ 0 or an sd that is absent, ≤ 0 or not finite. |
| G3 binding (FR-005) | `requireG3Binding`; `tma-hybrid` `inputs` | The G5 functions reused: ancestry, plan digests, `requireFrozenModels`, `requirePredictionChain`. |

**Order in `tma-g5` on a test split:**
1. Output-exists.
2. Decision binding: seed, clean tree, ancestry, plans, reference, carried trackers, models.
3. Prediction chain.
4. Scored once.
5. Load scenarios.
6. Re-computed sample.
7. Score; write `verdict.json`, `scoring.json`, `report.json`.

The cheap refusals come before loading the split.

**Cost.** 200 scenarios per re-computed estimator. The fused tracker and the hybrid also re-run
their IMM input. About 5 s per estimator, against 8 min for the verdict.

## Regression

Phase 4b, then phase 4c (disk). For each phase:

1. Data from a clean worktree at the base commit (`train-plan.mjs data <plan> <dir> test`).
2. The `run.sh` commands with the new build.
3. `tma-g5 … --repeat-of experiments/<id>` into a scratch folder.
4. Compare `checks` with the committed `verdict.json`.
5. Tampered cases on the real files:
   - a file with other settings under the frozen name;
   - one changed row;
   - a second scoring without `--repeat-of`;
   - the data header naming a commit before the decision.
