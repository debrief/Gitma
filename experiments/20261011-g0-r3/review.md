# G0 agent panel review

Constitution 1.2.0 (Governance): five independent specialist reviewers, read-only, iterated until
none rejects and no blocker or major finding is open.

Evidence under review: `experiments/20261011-g0/` (round 1), `experiments/20261011-g0-r2/`
(round 2, commit 54385fe) and this folder (round 3, commit 3c9aeb3 with the round-2 fixes; metrics
identical to rounds 1–2 apart from the new `non_converged_rate` field, which is 0 throughout).

## Round 1 (2026-10-11)

| Reviewer | Verdict |
| --- | --- |
| TMA geometry | approve-with-findings |
| Estimation and numerics | approve-with-findings |
| Evaluation statistics | approve-with-findings |
| Reproducibility (re-ran G0 at 6a27730 and HEAD: verdict and metrics byte-identical) | approve-with-findings |
| Red team (re-ran G0; refuted truth leakage, split overlap, prior-only shortcuts) | approve-with-findings |

### Major findings and responses

| # | Finding (reviewers) | Response | Commit |
| --- | --- | --- | --- |
| M1 | G0 never runs per-timestep classical, the G1 baseline (geometry, numerics, statistics, red team) | New check `classical-per-timestep-recovers`: 1,000 noise-free test scenarios, every row converged, every row ≥ 60 s after the zig within SC-001 tolerances; earlier rows reported. Result: 69,923/69,923 rows, worst 1.66e-4 | 7432cf1 |
| M2 | G0 partly circular: generator and solver share `bearingOf`/stored ownship (numerics) | New check `independent-geometry`: hand-computed 315° and abeam cases with literal `Math.atan2`, and t = 0 bearing/range against drawn parameters on all 10,000 test scenarios | 7432cf1 |
| M3 | Tolerances loose vs "numerical precision" (numerics) | New check `bearing-residuals-at-float32-precision`: RMS bearing residual ≤ 1e-6 rad on every final solution. Result: worst 4.84e-7 rad | 7432cf1 |
| M4 | Model and naive may be scored on different scenarios at zig+300s (statistics) | G1 checks require equal `n` and `excluded`, else fail with "sample mismatch" | 7432cf1 |
| M5 | Non-converged rows scored with placeholder values; NaN sort undefined (statistics, numerics) | Non-converged rows score +∞ on every metric; NaN sorts last; non-finite statistics omitted (absent median = +∞ in the gate); position mean over converged rows | 7432cf1 |
| M6 | Time-late consistency gated on tiny late-curve samples (n = 35) (statistics) | Curve points with n < 500 reported, not gated | 7432cf1 |
| M7 | Shuffled-label check optional; cannot see truth channels in inputs (statistics, red team) | Required in `G1Ids`, `tma-gate g1 --shuffled` and `tma-g1`; new counterfactual test: inputs byte-identical when target truth and drawn target parameters change | 7432cf1 |
| M8 | Manifest `git_commit` was not the code that ran (dirty tree) (reproducibility) | `git_dirty` recorded (as of process start); `tma-g0`/`tma-g1` refuse a dirty tree unless `--allow-dirty`. Round 1's code is 6a27730, not cfbeb16 as its manifest says (left unedited) | 7432cf1, 54385fe |
| M9 | No data digests (reproducibility) | `DatasetRef.digest` (schema 0.4.0) recorded per dataset; generation command listed | 7432cf1 |
| M10 | Training guard accepts an older G0 pass after a newer failure; not tied to generator (red team) | Only the latest G0 verdict counts; its manifest's `generator_version` must match the code | 7432cf1 |

### Minor findings

| Finding | Response |
| --- | --- |
| Naive reproducibility check is in-process only (4 reviewers) | Wording corrected; the real evidence is the reviewers' independent cross-process, cross-commit re-runs (byte-identical) |
| ≈ 2.2% of scenarios have no zig+300s row | Every estimator excludes the same scenarios (now enforced, M4); the G1 report states n and excluded |
| No confidence intervals | Deferred to the G1 report: bootstrap CI of the model/naive ratio, "inconclusive" if it crosses the threshold (tracked for T033) |
| `position_m_mean` is final-row mean, not SRD §5's window mean for time-late | Documented in the schema; the window-mean metric belongs to G2 reporting |
| Tiny range bands (0–2 km n = 155, 30+ km n = 9) | Results page shows n; no conclusions from slices with n < 200 |
| `window_s` is one sample longer than the data; ownship course leads the turn by one row at `zig_index` | Documented here; no effect on gates |
| LM can report converged at a stall | Converged-but-gross rows still count as gross; gradient test deferred to G3 work |
| `packages/types` has no golden test | `schema:check` is its golden (generated output byte-compared) |
| Seed reuse across datasets could overlap splits | Process rule: one seed per dataset (42 = G0, 101 = iteration 1); recorded in manifests |
| Weak observability at σ = 1° (8.75% classical gross) | Not a G0 defect; relevant to G2 thresholds |

## Round 2 (2026-10-11)

| Reviewer | Verdict |
| --- | --- |
| TMA geometry (also checked the 1e-6 rad residual limit on seeds 101, 5 and held-out ranges: worst 3.0e-7) | **approve** |
| Estimation and numerics | approve-with-findings (minor only) |
| Evaluation statistics | approve-with-findings (minor only) |
| Reproducibility (reproduced round 2 at 54385fe: verdict, metrics, data digests byte-identical) | approve-with-findings (minor only) |
| Red team | approve-with-findings (2 major) |

All round-1 majors confirmed resolved by the reviewers who raised them.

### Major findings and responses

| # | Finding | Response | Commit |
| --- | --- | --- | --- |
| R2-M1 | Guard orders G0 verdicts by folder name, so a newer failure or an undated folder can be outranked | Latest by manifest `created`; ties and G0 verdicts without a manifest refuse; tests with adversarial names | 3c9aeb3 |
| R2-M2 | Generator-version match does not prove the generator code is the verified code | Guard requires `git_dirty: false` and `packages/sim/src` unchanged since the G0 commit (`git diff` + untracked check); CI fetches full history | 3c9aeb3 |

### Minor findings and responses

| Finding | Response |
| --- | --- |
| Matched-sample guard missing from control and leakage checks | Added to every G1 check (3c9aeb3) |
| Consistency passes when both medians are absent | Now fails (3c9aeb3) |
| Absent statistics and converged-only position mean hide failures | `non_converged_rate` in metrics and curves (3c9aeb3) |
| No post-zig case in the independent-geometry check | Leg-2 hand-computed bearing added (3c9aeb3) |
| Counterfactual test leaves `mean_range_m`/`min_range_m` | Scrambled too (3c9aeb3) |
| Bootstrap CI deferral untracked | Written into T033 with the "inconclusive" rule |
| git runs in the caller's directory; no Node version in manifests | git runs in the package checkout; `node_version` recorded (3c9aeb3) |
| Stale `dist/` invisible to the dirty check | `pnpm tma-g0`/`tma-g1`/`tma-train` run `tsc -b` first; a hand-edited `dist/` remains out of scope |
| Per-timestep run not in the manifest | Recorded as `classical:per_timestep` with its settings (3c9aeb3) |
| `tma-eval` records but does not refuse a dirty tree | Accepted: it is an inspection tool; gates go through `tma-g0`/`tma-g1` |
| +∞ scoring makes classical P90 infinite above 10% non-convergence, which matters for G3 parity | Recorded for G3: compare on rows both estimators answer, report coverage separately |
| Per-timestep check covers 1,000 scenarios | Enough for G0; the full split runs in `tma-g1` for the G1 report |
| Guard does not require a panel mark on the verdict | Accepted: the panel record is this file; the verdict's `decided_by` is updated on approval |

## Round 3

Pending: red team and reproducibility reviewers re-invited on 3c9aeb3 and this folder.
