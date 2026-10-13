# G0 agent panel review: iteration 2 (generator 0.2.0)

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open.

Why G0 was re-run: iteration-2 PR A (#36) changed the generator paths (dataset-header provenance,
rate-limited ownship turn, `GENERATOR_VERSION` 0.2.0), so the iteration-1 G0 no longer covers the
code. Data: seed 42, 100,000 noise-free scenarios drawn from `configs/iter2-ranges.json`, so every
scenario contains a turn (0.5–3°/s) and the turn is exercised end to end, not only by unit cases.

Evidence:

- Round 1: `../20261013-g0-i2/` at b2b2aad (main after #34–#36).
- Round 2: this folder, at 24bbdab, which carries the round-1 fixes. The fixes changed
  `packages/data/src`, so G0 was re-run. Metrics are byte-identical to round 1. The manifest now
  names the ranges files by sha256.

| Check | Round 1 (b2b2aad) | Round 2 (24bbdab) |
| --- | --- | --- |
| classical-recovers-noise-free-truth | pass; worst range 7.19e-5, course 3.10e-2°, speed 6.73e-3 kt | same |
| classical-per-timestep-recovers | pass; 65,161/65,161 rows ≥ 60 s after the zig | same |
| bearing-residuals-at-float32-precision | pass; worst 3.41e-7 rad | same |
| independent-geometry | pass; hand cases incl. one starboard in-turn case | pass; starboard and port turns, mid-turn and leg 2 |
| naive-baseline-reproduces | pass | pass |

## Round 1 (2026-10-13)

| Reviewer | Verdict |
| --- | --- |
| TMA geometry (independent integration of the stated kinematics over all 10,000 test scenarios: worst position 9.4e-4 m, course 1.4e-5°; 4,962 port turns) | approve-with-findings |
| Estimation and numerics (reproduced row counts; in-turn rows solved separately; arc formula vs chord form ≤ 3.4e-9 m) | approve-with-findings |
| Evaluation statistics (regenerated the test split; exclusion counts per point) | approve-with-findings |
| Reproducibility (re-ran G0 at b2b2aad: verdict, metrics, seeds and digests byte-identical; dirty-tree refusal and lineage checked) | approve-with-findings |
| Red team (mutation: starboard-only turns; lineage bypass attempts; leakage) | approve-with-findings |

### Major findings and responses

| # | Finding (reviewer) | Response | Commit |
| --- | --- | --- | --- |
| M1 | The zig+600 s speed population is heavily selected: 38.9% of scenarios end before it (every window under ≈ 1000 s), and nothing in the outputs says so. R12's speed figure predates the turn (statistics; geometry agrees as a minor) | **User decision 13** (2026-10-13): speed stays at zig + 600 s. The gate detail now states the share of the slice that reaches each point. The G2 report must say that a speed pass covers windows of ≈ 1000 s or more. R12 was re-run on generator 0.2.0 (seed 302): classical at zig+300 s 8.1% / 3.3° / 1.16 kt [1.04, 1.30]; at zig+600 s 0.59 kt [0.52, 0.68]; 59.5% of the σ = 1° slice reaches zig+600 s | this PR |
| M2 | Resume, restore and continue skip lineage: a checkpoint's earlier epochs could have trained on other data (red team) | A resume now refuses when the checkpoint's train or validation features digest differs from the current files (test added). PR C (#37) adds `tma-train --check` (guard and lineage without training). Every CI train job runs it before its "already complete" no-op, and the evaluate job runs it too | 24bbdab, #37 |
| M3 | The training guard accepted a G0 whose `decided_by` was still the harness's, so training could start before the panel decided (reproducibility; red team as a minor) | `tma-train` now accepts the latest G0 only when `decided_by` starts "agent review panel" **and** `review.md` sits beside the verdict. `--allow-unreviewed-g0` exists only for the CI end-to-end run, which trains on a G0 made in the same job. `train.yml` never passes it | 24bbdab |

### Minor findings and responses

| Finding (reviewers) | Response |
| --- | --- |
| A port-turn sign error passed all of G0. Mutation `omega = rate` (red team) | `independent-geometry` now checks starboard and port turns, mid-turn and on leg 2, against literal trigonometry. Re-running the same mutation, the check fails (verified locally) |
| The G0 in-turn case covered one starboard sample only (geometry) | Same fix as above |
| `tma-gate g2` with `--slice`/`--point` overwrote `verdict.json` (red team) | Non-default options now write `verdict-diagnostic-<slice>-<points>.json` with `decided_by` "diagnostic only"; `verdict.json` is written only at the pre-registered slice and points |
| Manifest command lines said `--ranges <custom>`, so the digests could not be reproduced from the manifest alone (reproducibility) | `created_by` now names each ranges file by its sha256, shown in this folder's manifest |
| In-turn rows are neither estimated nor reported; the "first 60 s" figure counts from the end of the turn (numerics) | Out of G0's scope. The numerics reviewer solved them separately: in-turn rows behave like the early post-zig rows (worst 1.84e-2 within 30 s of the turn start, 1.9e-4 after 60 s). Docstring in `estimate.ts` corrected |
| Gate points now count from the end of the turn, so G1 and G2 points are not the same elapsed time after the manoeuvre (statistics, numerics, geometry) | To be stated in the iteration-2 report beside the G1 comparison (T052, T054) |
| Window-mean position drops non-converged rows rather than scoring +∞ (statistics) | Report-only metric (R10); the report states the rule. No change |
| `bootstrap.json` and metrics are matched by `n` only; samples are matched on counts, not scenario identity (statistics, red team) | Fails closed today (deterministic emission). Logged for iteration 3 with the `bootstrap.json` schema class |
| G0 never runs the gate-point scoring path on real data (statistics) | Covered by the phase-A validation run (`tma-g2 --split validation`) before any test scoring, and by unit and golden tests. Not added to G0 |
| Lineage does not cover features code, schema or norm-file digest; the dirty check covers source, not `dist/` (red team, reproducibility) | Recorded as known limits. The commit and dirty flag of the training code are in every model manifest (schema 0.6.0); features are rebuilt in each CI job from the plan |
| Schema `FeatureLayout` description says loss mask "t ≥ zig_time"; code uses t > zig_time (geometry) | Corrected at the next schema bump (a description-only change would otherwise churn every golden) |
| Speed-check headroom shrank (worst 6.73e-3 of 0.01 kt) (numerics) | Noted; consistent with float32 bearings at long range |
| `train.yml` still on iteration 1 (red team) | Replaced by plan files in #37. An iteration-2 plan refuses seeds 42 and 101 and iteration-1 ranges |

## Round 2 (2026-10-13): responses re-reviewed

| Reviewer | Verdict |
| --- | --- |
| TMA geometry (re-derived the four new turn bearings by independent integration: all match to 1e-5°) | **approve** |
| Estimation and numerics | **approve** |
| Evaluation statistics (M1 resolved; R12 coverage matches its own count: 61.2% reach zig+600 s) | **approve** |
| Reproducibility (re-ran G0 at 24bbdab from this manifest: verdict, metrics, seeds and dataset digests byte-identical; guard refuses as committed, accepts once decided_by names the panel, refuses without review.md) | **approve** |
| Red team (the port-turn mutation now fails `independent-geometry`, exit 3) | approve-with-findings |

| # | Finding (reviewer) | Response | Commit |
| --- | --- | --- | --- |
| M4 | PR #37: when a checkpoint is already complete, nothing compares its feature digests with the job's files, so a model from another plan or dataset could be reused (red team) | `tma-train --check` refuses when `--out` holds a model trained on other train or validation features (test added); CI runs it before the "already complete" no-op | ef02552 (#37) |
| – | The guard's `^agent review panel\b` match accepted "agent review panel (pending…)"; review.md exists before the decision (red team) | The match now needs "agent review panel, round N (no rejections", the form every panel decision uses. Still an honour system; it guards against accidents, not forgery | c5f245d |
| – | The library default `requireReview: false` is unsafe for future callers (reproducibility) | Panel review is now the default; only `tma-train --allow-unreviewed-g0` turns it off, and only `ci.yml` passes that flag (`git grep allow-unreviewed -- .github scripts`) | 365cc5f, ef02552 |
| – | PR #37 must keep `requireReview` on its `--check` path and pass the flag in its own CI step (reproducibility, red team) | Merged i2/g0 into #37; its new end-to-end step passes the flag; `train.yml` and `train-model.yml` do not | ef02552 |
| – | The coverage text in the G2 detail has no test (statistics) | Asserted in `gate-g2.test.ts` | c5f245d |
| – | Diagnostic file name omits the course point (statistics); written with `JSON.stringify`, not `canonicalJson` (red team) | `--point` always sets range and course together, so the tag is unique. Not machine output of record; left as is |

## Round 3 (2026-10-13): red team re-check

| Reviewer | Verdict |
| --- | --- |
| Red team (M4 fixed: `--check` refuses any manifest in `--out` whose digests differ, incomplete or complete; missing digests fail the schema; the round-2 forged `decided_by` no longer matches; `--allow-unreviewed-g0` appears only in `ci.yml`) | approve-with-findings (minors only) |

| Finding | Response |
| --- | --- |
| `--check` does not compare configs: a complete model from the same features but another config would be reused | `--check` now also refuses a model whose config differs, as the resume path does (test added) on #37 |
| Committed weights are never checked against `weights_digest` when loaded | Out of this gate's scope; logged for the G2 evidence check (the panel re-scores committed weights) |
| Duplicated sentence in the `requireReview` doc comment | Fixed |

## Decision

No reviewer rejects; no blocker or major finding is open (M1–M4 answered). **G0 passes for
generator 0.2.0** at 24bbdab (this folder). `decided_by` is set to rounds 1–3; the round-1 folder
`../20261013-g0-i2/` is marked superseded. Training on iteration-2 data is allowed from here
(the guard needs this panel decision and this file).
