# Tasks: Spec 015 — tighten the G5 gate's bindings

- [x] T001 Spec, plan, research from the panel follow-ups (4b and 4c `review.md`, 4c `g5.md`)
- [x] T002 Schema 0.18.0: `GateScoring`, `GateRecomputation`; `pnpm schema:gen`. Goldens
      regenerated: only the schema version string changes.
- [x] T003 FR-001: round-trip name parsers (`@tma/classical` `names.ts`); `rawPredictionLine`;
      `recompute.ts` (`sampleScenarios`, `recipeFor`, `requireRecomputed`). Tests: passing (IMM,
      fused, hybrid as made; network stored) and refusing (other k, other IMM settings, other θ,
      one changed byte, unknown name, missing input).
- [x] T004 FR-002: ancestry check in `requireG5Binding` before the frozen-model return. Tests:
      after or at the decision passes; before it, no commit or a dirty tree refuses.
- [x] T005 FR-003: `scoring.json`, `requireScoredOnce`, `--repeat-of`; backfilled `scoring.json` for
      `20261101-p4h-g5` and `20261102-p4f-g5`. Tests: first scoring; same decision by path or
      digest refused; reproduction named; wrong or self `--repeat-of`; G5 verdict without
      `scoring.json`.
- [x] T006 FR-004: `usableRange` in `fusedPredict`. Tests: range ≤ 0 or non-finite and sd ≤ 0 or
      non-finite skipped; valid rows unchanged; a bad row equals a skipped one.
- [x] T007 FR-005: `requireG3Binding`; `tma-hybrid` records `inputs`; `tma-g3 --plan --model
      --network`. Tests: pass and refuse for ancestry, plans, models, chain.
- [x] T008 Regression, phase 4b: data, `run.sh`, `--repeat-of`, checks identical; tampered cases
- [x] T009 Regression, phase 4c: as T008; guard count on T2's test rows (R4)
- [x] T010 FR-006: the reference IMM's covariance, cause and proposed fix (R5); IMM unchanged
- [x] T011 AGENTS.md, `site/docs/evaluation.md`, the fused-tracker and trackers notes
