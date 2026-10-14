# Implementation Plan: Iteration 2b — speed-weighted loss

**Spec**: [spec.md](spec.md) · **Builds on**: spec 003 (plan, research R5, R19)

## Constitution check (1.2.0)

| Principle | How it holds |
| --- | --- |
| I. Types from LinkML | No new data types. `ChangeDecision` and the training config already carry the fields used. |
| II. Determinism | Same seeds and batch order. The fresh test split is a seeded generation pinned by its content digest. |
| III. Portability | Loss weights live in the manifest config. No new layers. |
| IV. Baselines alongside | `tma-g2` scores naive and classical on the fresh test rows beside every model. |
| V. Gates | G0 for generator 0.2.0 has passed (panel). This is the one extra iteration that SRD §7 allows after G2. |

## User decisions (2026-10-14)

15. **Change**: `loss_weight_speed` 1 → 4, chosen over 2 and 8. The panel measured per-row loss
    terms on the phase-B test predictions: log-range 0.103, sin+cos 0.213, scaled speed 0.056.
    Weight 4 lifts speed from about 15% of the loss to about 40%, comparable with course.
16. **Start point**: continue from the committed phase-B weights rather than retrain from scratch.
    Adam restarts once, with a 3-epoch patience grace. `max_epochs` is 220 and patience 6.
17. **Test split**: a fresh one (seed 202, same count and ranges) rather than reusing the
    iteration-2 test split.

## Design

- **Loss change on resume** (FR-002): `train.ts`, on a resume with an optimizer restart, reloads
  `best/` and recomputes its validation loss with this config's term weights. Without this, the
  recorded best (weight 1) would be lower than every later epoch's loss (weight 4). Early stopping
  would then keep phase B's weights unchanged.
- **Fresh test** (FR-003): `dataset.fresh_test` in the plan. `train-plan.mjs data` generates the
  fresh seed's dataset into a temporary folder (about 20 s for 110,000 scenarios), moves its
  `test.f32pack` into place, and removes the rest. `check-digests` uses the fresh digest for test.
- **R19 tooling** (FR-005): in `tma-g2`:
  - `--plan`, which spawns `train-plan.mjs check-digests`;
  - the decision-ancestry check (`git log --diff-filter=A`, then `git merge-base --is-ancestor`);
  - `requireSameRows` on every scored set: carried, other phase and held-out.
  `evaluate-args` passes `--plan` for a test evaluation.
- **Plan** `configs/iter2/c/plan.json` (branch `train/i2c`): seed 201, the same digests as plan
  b, fresh test seed 202, `continue_from` the phase-B models, `continue_allow`
  `[max_epochs, loss_weight_speed]`, evaluated on validation.
- **Decision record**: `experiments/20261014-i2c-decision/decision.json` and `decision.md`,
  committed in the setup PR before training.

## Sequence

1. Setup PR: tooling, tests, spec, configs and the decision record. Merge it.
2. Push `train/i2c` to train on GitHub Actions; results arrive on `results/i2c-<run>`.
3. Commit the validation results (`experiments/<date>-i2c-val`).
4. Score G2 on the fresh test split locally, at a clean main commit:
   `tma-g2 --split test --plan configs/iter2/c/plan.json --decision <2b decision> --compare-models <phase-B models>`.
5. Run the agent review panel, then write `review.md` and set `decided_by`.
6. Site write-up: the results page and the blog post.

## Risks

- **Weight 4 costs range or course.** Range has margin (16.5% against 20%), but the course pass is
  narrow (upper bound 9.90°). The verdict will show it, and there is no fallback set (FR-006).
- **Patience stops the run early again.** Validation noise of about ±3% exceeds the per-epoch
  gain. Accepted, as decided. The smoothed stopping criterion stays a lead, not part of 2b.
- **The runner budget runs out.** One LSTM epoch takes about 17 minutes, so three chained jobs
  give about 60 epochs per push. A re-push resumes from the checkpoints.
