# Feature Specification: Iteration 3 — A Second Zig Across the Line of Sight (Gate G2)

**Feature Branch**: `007-iteration-3-second-zig`

**Created**: 2026-10-17

**Status**: Stopped at validation (FR-006), 2026-10-22: LSTM speed 1.10 kt [1.06, 1.16]; test split not scored.

**Input**: The owner's realism check in the engagement viewer (spec 006). The engagements look
right, but with both platforms on steady legs there is not enough information for TMA: the zig
comes late, and an operator who has no steady solution zigs again, traditionally across towards
the contact. The diagnostic in [research.md](research.md) R1 tested these ideas on the seed-203
test predictions. The owner chose a second zig with both turns across the line of sight, keeping
the first zig's timing.

**SRD trace**: Annex A Part B: lever B.2.1 (observability in the data) under the sequence and
rules of B.3; §3 (new parameter rows); §5 (G2 thresholds, times, slices and intervals unchanged);
§8 (panel, decision 22); §9 (blog, results).

**Out of scope**: an adaptive manoeuvre that zigs only when the estimate is unsteady (the
generator plans ownship's path in advance; see research R3); output parameterisation, derived
features, training changes and capacity (levers B.2.2–B.2.5); real data.

## The single change

The problem changes; the models do not.

- **Generator 0.3.0.** Two new options in the parameter ranges, both off by default so earlier
  ranges reproduce generator 0.2.0's scenarios byte for byte:
  - `zig_rule: across_los`. Each zig turns ownship so that the target ends on the **other bow** at
    an angle off drawn from `los_offset_rad`, by the shorter turn. It uses the true bearing at the
    last sample before the turn.
  - `zig2_delay_s`. A second zig starts this long after leg 2 begins, at the first zig's turn
    rate, giving three legs. A second turn that does not complete inside the window is redrawn.
- **Iteration-3 ranges** (`configs/iter3-ranges.json`, `configs/iter3-heldout-ranges.json`):
  - The iteration-2 ranges, plus `across_los` with an offset of 30–90° for both turns.
  - A second zig 180–300 s after leg 2 starts.
  - Unchanged: window 10–40 min, first zig at 40–60% of the window, turn rate 0.5–3°/s, speeds,
    ranges, σ 1–2°, dropouts. The held-out set keeps its 20–30 km start ranges.
- **Dataset**: seed **204**, count 100,000, splits as `planSplits`. Its own test split decides G2;
  204 is reserved afterwards. Seeds 201–203 are not used.
- **Models**: the 2c configuration, from scratch on the new data (`configs/iter3/a`):
  - 2 × 128 stacked recurrent layers for the instantaneous LSTM, the time-late BiLSTM and the
    shuffled control.
  - CNN and MLP controls at their sizes.
  - `loss_weight_speed` 4, `max_epochs` 150, patience 6, raw features, the same training seeds.

## User stories

### US1 — Generate and see the new engagements (P1)

Generator 0.3.0 and the iteration-3 ranges. The viewer draws both turns and all three legs and
lists the second zig. The seed-204 validation split is in the viewer catalogue, so the owner can
check the new engagements before any training (B.2.1).

**Acceptance**:
- Unit tests show both turns cross the line of sight to an offset inside the drawn range, and
  that leg 3 is steady.
- Hand-worked known answers pass for the turn rule and for the second zig, instantaneous and
  rate-limited.
- The 0.2.0 golden scenarios are unchanged, and a new golden file pins the three-leg generator.

### US2 — G0 on generator 0.3.0 (P1)

G0 re-run on seed 42 (noise-free, iteration-3 ranges), then the agent review panel. `tma-train`
refuses to train until that G0 passes its panel (the G0 guard checks the generator version).

### US3 — Pre-register, train, validate (P1)

The decision record (`experiments/<date>-i3-decision/`) is committed before training. It holds
the change, the forecast, the carried-set rule and seed 204. Then plan `configs/iter3/a/plan.json`
(digests pinned), branch `train/i3a`, and a validation diagnostic before any test scoring.

### US4 — Gate and record (P1)

`tma-g2 --split test --plan --decision --compare-models` scores the carried set once on the
seed-204 test split, with the 2c models beside it as the other phase. Then the agent review panel,
`review.md`, `decided_by`, a results page and a blog post.

## Functional requirements

- **FR-001**: Ranges without `zig_rule` and `zig2_delay_s` MUST reproduce generator 0.2.0
  byte for byte. The new draws come after every 0.2.0 draw.
- **FR-002**: `zig_angle_rad` and `zig2_angle_rad` record the realised signed turns, so
  `simulateTruth(parameters)` alone reproduces the tracks.
- **FR-003**: Metadata records `zig2_index` (first sample on leg 3) and `turn2_start_index`. Gate
  times still count from `zig_index`, the first sample after the **first** turn.
- **FR-004**: Generator 0.3.0 reads 0.1.0 and 0.2.0 datasets. `tma-train` requires a G0 on 0.3.0.
- **FR-005**: The decision record MUST be committed before any iteration-3 weights are trained.
  `tma-g2` checks ancestry.
- **FR-006 (validation rule, B.3.3; amended after G0 panel rounds 1–2, statistics).** A lever
  that changes the problem has no like-for-like counterfactual for B.3.3's "moved speed". 2c's
  figures are on another problem. 2c scored on the new problem degrades out of distribution: on
  scratch seed 9001 its LSTM reaches 1.93 kt here, against 1.49 kt on the iteration-2 ranges. The
  rule is therefore:
  1. Score both sets on seed 204's validation split, σ = 1°, zig + 600 s, on rows common to both:
     the iteration-3 models, and the 2c models as the other phase (`tma-g2 --compare-models`). It
     writes `paired.json`, with paired bootstrap intervals from `bootstrapMedianRatio`, 2,000
     resamples, seed 20261011.
  2. **Operative condition.** The iteration-3 LSTM's G2 speed interval has a lower bound under
     1 kt, so a G2 pass is possible.
  3. **Sanity condition (weak reference).** The paired median speed ratio, iteration-3 LSTM over 2c
     LSTM, has a 95% interval wholly below 1. 2c degrades on the new problem, so this shows only
     that training on it helped, never that the lever worked.
  4. **Reported measure of what the models gained.** The paired median speed ratio, iteration-3
     LSTM over classical on the same rows, with its interval. 2c's 2.37 (1.42 / 0.60 kt) on its
     own validation is context only: unpaired, and on another problem.

  The time-late model is reported the same way, not as a condition. The carried pair goes to the
  test split only if conditions 2 and 3 both hold. Otherwise the iteration stops at validation and
  is written up. The write-up does not cite condition 3 as evidence that the lever worked.
- **FR-007**: The carried set is the iteration-3 LSTM and BiLSTM, unconditionally. The 2c models
  are scored beside them on the same split, reported and never gated.
- **FR-008**: Thresholds, slices, bootstrap and the gate rule are spec 003's as amended by the G2
  panels. Classical and naive are re-baselined on the new data, and the improvement is reported
  rather than subtracted (B.2.1). Zig bands run to 180°. Every slice is reported with its n, and
  slices under 100 rows are marked indicative. Bands are not compared across iterations: a 30–90°
  across-LOS turn is not the same population as iteration 2's.
- **FR-009 (decision binding; G0 red team).** From iteration 3, `tma-g2 --split test` requires a
  committed decision whose `plan` names the plan being scored and whose `test_seed` matches it. An
  earlier iteration's decision cannot unlock seed 204's test split. A decision binds by the plan's
  path or by its content (a test seed of 204 or later), and must name its `test_seed`.

## Reading the gate under three legs (G0 panel, statistics and geometry)

Gate times still count from the end of the **first** turn. On the G0 test split:

- **The second turn.** It starts 180–300 s after the zig (median 240 s) and lasts 20–350 s
  (median 70 s).
- **At zig + 300 s.** 4% of scenarios are still on leg 2, 59% are mid-way through the second
  turn and 37% are on leg 3. Range and course are judged mostly **during** the second manoeuvre.
- **At zig + 600 s.** 99.9% are on leg 3, with a median of 280 s of it (p10 190 s, p90 340 s).
  Speed is judged after 4–5 minutes of leg 3.

So zig + 300 s is not like-for-like with iterations 1–2c, and the report says so. The
re-baselined classical figures, on the same rows, sit beside every model figure.

**Realised distribution.** Redraws (second turns that do not complete) remove short windows, so
"10–40 min" is no longer uniform:

| Statistic | Value |
| --- | --- |
| redraws per scenario | 0.21 |
| window p10 | 16.7 min (first draws: 13.0 min) |
| window median | 27.7 min (first draws: 25.2 min) |
| scenarios with 10–15 min windows | 5.6% (16.7% if uniform) |
| mean turn rate | 1.83°/s (first draws: 1.75°/s) |
| reaching zig + 300 s | 98.9% |
| reaching zig + 600 s | 65.4% |

The drawn delay is rounded to whole samples, so 180 s and 300 s carry half the weight of the
interior values.

## Success criteria

- **SC-001**: One test scoring of seed 204 for the carried set, with 2c beside it.
- **SC-002**: Every reported model figure sits beside naive and classical on the same rows.
- **SC-003**: The write-up separates what the easier problem gave every estimator from what the
  models gained against classical.

## Risks

- **Large turns.** With an offset of 30–90° on the other bow, the median first turn is 143° (p90
  173°), against 61° in iteration 2. The owner checks this in the viewer (US1). A cap on turn size
  would be a further change to the problem.
- **Longer windows.** Redraws for second turns that do not fit remove short windows (see "Reading
  the gate under three legs").
- **An easier problem.** Every estimator gains, so a G2 pass is a pass on the three-leg problem,
  and is reported as such.
