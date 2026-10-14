# Feature Specification: Iteration 2b — One More Change Round for G2 (Speed)

**Feature Branch**: `004-iteration-2b-speed`

**Created**: 2026-10-14

**Status**: Planned. User decisions 15–17 were made on 2026-10-14.

**Input**: G2 failed on speed (`experiments/20261014-i2-g2/`, panel round 2). The instantaneous
model's speed error was 2.09 kt [2.00, 2.18] and the time-late model's 2.38 kt [2.28, 2.48],
against a 1 kt threshold. Classical reached 0.62 kt, at the Cramér–Rao bound. Plan decision 5 of
spec 003 allows one more iteration after a G2 fail. The user chose a speed-weighted loss
(decision 15), continued from the phase-B weights (decision 16), and judged on a fresh test split
(decision 17).

**SRD trace**: §5 (G2 thresholds, slices, bootstrap intervals), §7 (iteration 2: "one more
iteration allowed, then stop"; hyperparameter cap), §8 (agent review panel; leakage), §9 (blog,
results review). Builds on spec 003 (data, features, `tma-g2`, plans, panel record) and its research
R19 (prerequisite tooling).

**Out of scope**: derived features (R6), the per-leg steady-track fit (R18), new architectures, new
data ranges, and the turn-only diagnostic. Each stays a lead for any later work. 2b is the last
iteration under G2: if G2 fails again, the project stops at G2 and writes the no-go (SRD §7).

## User stories

### US1 — Speed-weighted continuation (P1)

Every iteration-2 model continues from its committed phase-B weights. The only change is
`loss_weight_speed` 1 → 4; range and course stay at 1. Data, features, architectures, learning
rate, batch order and seeds are unchanged. `max_epochs` is 220 (about 150 epochs beyond phase B's
best) and patience stays at 6.

**Acceptance**:
1. Given phase B's weights and the 2b config, seeding refuses any config change other than
   `max_epochs` and `loss_weight_speed`.
2. Given a seeded continuation whose loss changed, when training resumes, the best epoch's
   validation loss is re-scored under the new loss before any epoch is compared with it.

### US2 — A fresh test split (P1)

G2 for 2b is judged on the test split of a new seed (202), with the same count and ranges. It is
never judged on the iteration-2 test split, which already decided one gate. Train, validation and
held-out stay those of seed 201.

**Acceptance**: the plan pins the fresh split's content digest; `train-plan.mjs data` replaces
`test.f32pack` with it, and `check-digests` checks it.

### US3 — Gate-integrity tooling (P1; G2 panel R19)

1. `tma-g2 --split test` needs `--plan`. It checks the data's content digests against the plan and
   records the result in the manifest.
2. `tma-g2 --split test --decision d` refuses unless the commit that added `d` is an ancestor of
   every carried model's `git_commit`. The decision must predate the weights.
3. `tma-g2` refuses to score if any estimator predicts rows (scenario and timestamp) different from
   naive's.

### US4 — Gate and record (P1)

The sequence:
1. Validation diagnostic (`tma-g2 --split validation`).
2. G2 on the fresh test split, scored once, with phase B scored beside it on the same split
   (`--compare-models`).
3. The agent review panel, run until no reviewer rejects and no blocker or major finding is open.
4. `review.md` and `decided_by`.
5. Site pages: results and blog.

## Functional requirements

- **FR-001**: Seeding a 2b continuation MUST be refused unless the config differs from phase B's
  only in `max_epochs`, `loss_weight_speed` and `max_wall_s`.
- **FR-002**: On a resume with an optimizer restart, `tma-train` MUST re-score the best epoch's
  weights on validation under the current config's loss, and use that value as the best.
- **FR-003**: A plan MAY name `dataset.fresh_test {seed, digest}`. The seed MUST NOT be the
  plan's own dataset seed or a reserved seed. The digest check MUST apply the fresh digest to
  `test.f32pack`.
- **FR-004**: The FR-003 refusal on reused seeds also covers the iteration-2 test: seed 201 is the
  plan's own seed, so it cannot be named as the fresh seed.
- **FR-005**: The R19 checks (US3) MUST run on every `--split test` scoring.
- **FR-006**: The carried set for 2b is the 2b models, unconditionally. Phase B is reported beside
  it on the fresh test split, never gated. This is pre-declared in the decision record.
- **FR-007**: The G2 thresholds, slices, bootstrap and gate rule are unchanged from spec 003, as
  amended by the G2 panel: pass needs the CI and the point below the threshold; fail needs the
  CI's lower bound at or above it.

## Success criteria

- **SC-001**: The 2b decision record is committed (and merged) before any 2b weights are trained.
  `tma-g2` checks this.
- **SC-002**: The fresh test split is scored once for the carried set.
- **SC-003**: Every reported model figure sits beside naive and classical on the same fresh test
  rows.
