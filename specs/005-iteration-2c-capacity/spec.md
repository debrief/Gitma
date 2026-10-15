# Feature Specification: Iteration 2c — Capacity and Loss Together (Gate G2)

**Feature Branch**: `005-iteration-2c-capacity`

**Created**: 2026-10-15

**Status**: Planned. User decisions 18–20 made on 2026-10-15; SRD §7 amended the same day.

**Input**: Iteration 2b (spec 004) on validation: speed 1.77 kt against 1 kt, everything else
passing. The capacity scan (spec 003 research R20): larger models halve the epochs to the same
plateau. Each lever moves speed; neither reaches 1 kt alone. The user chose to score 2b's fresh
test as pre-registered and, in parallel, amend SRD §7 for one further iteration combining both
levers, judged on a new fresh split.

**SRD trace**: §5 (G2 thresholds, slices, intervals), §7 (as amended 2026-10-15: iteration 2c,
then stop; hyperparameter cap), §8 (panel), §9 (blog, results). Builds on specs 003 and 004 and
their tooling (plans with `fresh_test`, `layers`, `tma-g2 --plan`, decision ancestry).

**Out of scope**: derived features (R6), the per-leg fit (R18), new architectures beyond stacking,
a seed sweep. 2c is the last iteration under G2: a fail stops the project at G2.

## User stories

### US1 — Train the combined configuration (P1)

From scratch on the iteration-2 data: 2 × 128-unit stacked recurrent layers for the instantaneous
LSTM, the time-late BiLSTM and the shuffled control; `loss_weight_speed` 4; `max_epochs` 150,
patience 6; CNN and MLP controls at their existing sizes with the same loss. Plan
`configs/iter2/d/plan.json`, branch `train/i2d`, validation diagnostic first.

**Acceptance**: every model trains to early stopping or the cap across chained jobs; the
validation diagnostic reports all twelve checks beside naive and classical.

### US2 — Fresh test split, seed 203 (P1)

G2 is judged once on the test split of seed 203, pinned by content digest; seeds 201 and 202 are
never used for this gate. The 2b models are scored beside as the other phase, never gated.

### US3 — Gate and record (P1)

`tma-g2 --split test --plan --decision --compare-models`, the agent review panel to no rejection
and no open blocker or major, `review.md`, `decided_by`, results page and blog post. If G2 fails,
the no-go write-up (SRD §7).

## Functional requirements

- **FR-001**: The decision record `experiments/20261015-i2d-decision/` MUST be committed before any
  2c weights are trained; `tma-g2` checks ancestry.
- **FR-002**: The plan MUST pin the seed-203 test digest; `data` and `check-digests` apply it.
- **FR-003**: The carried set is the 2c models, unconditionally (pre-declared).
- **FR-004**: Thresholds, slices, bootstrap and the gate rule are those of spec 003 as amended by
  the G2 panel.

## Success criteria

- **SC-001**: One test scoring of seed 203, for the carried set, with 2b beside it.
- **SC-002**: Every reported model figure sits beside naive and classical on the same rows.
