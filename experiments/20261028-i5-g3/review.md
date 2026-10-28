# Iteration 5 G3 on seed 207: run log and review

Decision: `../20261027-i5-decision/` (decision 24, spec 009). Code at commit 4bca164 (main, the
merge of PR #57). The only change to `packages/` after the decision record is cc4365c, a test-only
fix to `packages/eval/test/cli-g3.test.ts`.

## Test data (recorded before scoring)

`node scripts/generate-splits.mjs --seed 207 --count 200000 --ranges configs/iter4-ranges.json
--heldout-ranges configs/iter4-heldout-ranges.json --out data/i5 --splits test`, from a clean tree
at 4bca164:

- `data/i5/test.f32pack`: seed 207, split test, indices [180000, 200000), 20,000 scenarios,
  generator 0.3.0, `generator_git_commit` 4bca164, `generator_git_dirty` false, 4,358 redraws.
- Content digest (`train-plan.mjs digest`):
  `bc72f976acf050ec45b65a744d9929bfd6e86e8faa7a22a27660bedd25b7ae5a`.
