# G0 on generator 0.4.0 (phase 3): agent review panel

Gate G0 for generator 0.4.0 (spec 010 T008; SRD Annex B §B.2–B.3). Five independent read-only
reviewers, one per speciality (AGENTS.md, constitution 1.2.0).

- **Round 1** reviewed `experiments/20261028-g0-p3/`, run at f138bd4 on 100,000 noise-free
  scenarios (seed 42), with the code at 3105c6a.
- **Round 2** reviews `experiments/20261028-g0-p3-r2/`, re-run after the round-1 fixes.

Reproducing the run: `tma-generate --seed 42 --count 100000 --noise-free --ranges
configs/phase3-ranges.json --heldout-ranges configs/phase3-heldout-ranges.json --out data/g0-p3`,
then `tma-g0 --data data/g0-p3 --experiment <dir>`. The manifest records the ranges by digest only
(reproducibility, minor 1).

## Round 1

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve-with-findings | 0 | 0 | 5 |
| Estimation and numerics | approve-with-findings | 0 | 3 | 3 |
| Evaluation statistics | approve-with-findings | 0 | 2 | 5 |
| Reproducibility | approve-with-findings | 0 | 0 | 3 |
| Red team | approve-with-findings | 0 | 2 | 2 |

None rejected. Below, each major finding and its response, then the minors.

### Major findings

**N1 (numerics). "The EKF drifts for every process-noise setting" is false.**
- The reviewer reproduced the drift with an independent EKF and a UKF. The cause is the
  constant-velocity model over the turn followed by covariance collapse.
- But σ_a/σ = 0.32 ends at 0.33% on the port case.
- _Response: fixed in wording._ `trackers.md` and Annex B §B.3 now state the mechanism and the
  counter-example. Choosing the IMM does not depend on the EKF failing everywhere.

**N2 (numerics). At σ = 1° the IMM is not stronger than the single EKF at the gate point.**
- On 200 scenarios, the EKF reaches 16.6% median and 39.6% P90; the IMM reaches 17.8% and 51.6%.
- _Response: accepted, and moved to the decision record._ Spec 010 FR-011 now requires the
  decision record to settle whether G4 gates against the tuned IMM alone or the better of the two
  tuned trackers, with a widened IMM grid. That grid includes a P0 scale and, from N2 and R2
  below, low switch rates. The owner will be asked; G0 does not depend on it.

**N3 (numerics). The re-convergence gate covers one favourable geometry and one setting.**
- 11 of 72 variants fail, mostly at 3°/s.
- _Response: fixed._
  - The check's description now claims only that the implementation follows a turn.
  - 24 variants (30–120°, 0.5–3°/s, both sides) are reported, not gated.
  - `trackers.md` no longer generalises from the one setting.

**S1 (statistics). Phase-3 held-course figures are not comparable with iterations 2–4.**
- Windows under about 1,100 s disappear: P10 is 1,360 s against 990 s, and coverage at
  zig + 10 min rises from 65% to 88%.
- _Response: fixed in the record._
  - Annex B §B.2 now states the shift.
  - B.4's G4-control row says G2 is re-run on phase-3 held-course data.
  - FR-011 also asks the decision record to size the control's test seed.
  - The coverage note in AGENTS.md is updated.

**S2 (statistics). Turn timing is predictable.**
- Turns start 2–8 min after the zig (P10–P90), with r = 0.92 against window length.
- A network could learn a prior the IMM's constant switch rate lacks.
- _Response: accepted._ FR-011 pre-registers two slices: turn before or after zig 2, and ownship
  manoeuvre after the turn yes or no (also geometry minor 3). Whether to decouple turn timing is
  for the decision record. A causal instantaneous model cannot use the window-end bound (red
  team).

**R1 (red team). G0 never checks post-turn bearings against the stored positions.**
- Two mutations passed G0: bearings from the unturned track (M1) and bearings one sample late
  (M2).
- _Response: fixed._
  - `independent-geometry` now checks every valid noise-free bearing against `atan2` of the stored
    positions, to within 1e-5 rad.
  - `tracker-noise-free` gates the post-turn median at 1e-2; 2.4e-3 is observed.
  - A regression test reproduces M1.

**R2 (red team). The IMM is checked only noise-free.**
- A mis-scaled measurement variance (I5) passed G0.
- _Response: fixed._ A new check, `tracker-noisy-sanity`, regenerates 200 scenarios at σ = 1° from
  the dataset's ranges. At the last sample before each turn, it requires the straight-leg IMM's
  median range error to be within 1.25 × that of per-timestep batch least squares.
  - Probing it found the settings matter: G0's noise-free settings give 1.8 ×, while σ_cv 0 with
    switch 1e-5/s gives 0.92 × on a 120-scenario probe and 1.07 × in the round-2 run.
  - That is recorded in `trackers.md` and research R2: the tuning grid must include low switch
    rates.

### Minor findings

**Geometry.**
1. _Window loss understated._ Fixed in `generator.md` and Annex B §B.2.
2. _Annex B said the turn "starts" 6 min before the window ends; the code requires it to end
   then._ Annex fixed.
3. _The straight-track across-LOS rule is legitimate._ The slice is in FR-011. The mutation of zig 2
   planned on the turned track (red team M9) is caught.
4. _Held-course direction was checked only through the solver._ Now checked directly: a step whose
   ends share a course must be v·dt along it.
5. _Straight legs could run about 1% slow._ Now caught by the same rule.

**Numerics.**
1. _"No tracker recovers it exactly" overstated._ Now reads "no filter with process noise". The
   constant-speed prior is named as the network's possible advantage.
2. _Re-initialisation refits over the whole track._ Recorded in `trackers.md`; left as is,
   because it applies equally at every tuning.
3. _P0 may be overconfident under noise._ A P0 scale is added to the grid in FR-011.

**Statistics.**
1. _Angle and rate distributions lean towards short turns._ Stated in Annex B and `generator.md`.
2. _`manoeuvre=held` had n = 10,000 in G0 metrics because truncation removed the indices._ Fixed:
   the slice now comes from the drawn angle, so truncated scenarios keep their band.
3. _"final" in G0 mixes regimes, and naive is fitted on full scenarios._ Stated here. G0's naive
   check is about determinism only, and naive figures from this G0 are not comparable with
   earlier G0s.
4. _Turn-time wording._ Same fix as geometry minor 2.
5. _Control power._ In FR-011.

**Reproducibility.**
1. _Ranges recorded by digest only._ The paths are given above.
2. _No `review.md` yet._ This file.
3. _Uncommitted guard test._ Committed.

**Red team.**
1. _Turn rate at half the stored value, and turn indices shifted by one sample (M3, M10, M11)._
   Every step wholly on an arc must now turn exactly ω·dt. Regression tests cover all three.
2. _Held-out footgun._ `tma-generate` now refuses ranges with a target manoeuvre unless
   `--heldout-ranges` is given.

Caught already: M5–M9 and I1–I4. No leakage: features read no manoeuvre data.

## Round 2

The panel reviewed `experiments/20261028-g0-p3-r2/`, run at ff5f7cd with a clean tree; the code
was at 27333cd. Between ff5f7cd and 27333cd only a test and docs changed.

| Reviewer | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| TMA geometry | approve | 0 | 0 | 1 |
| Estimation and numerics | approve-with-findings | 0 | 0 | 3 |
| Evaluation statistics | approve | 0 | 0 | 2 |
| Reproducibility | approve-with-findings | 0 | 0 | 2 |
| Red team | approve-with-findings | 0 | 0 | 2 |

None rejected, and no blocker or major finding is open.

**What the panel confirmed:**
- **Reproduction.** The run reproduced byte for byte: verdict, metrics and seeds.
- **Red-team mutations.** Every key mutation now fails G0: M1, M2, M3, M10 and M11 fail
  independent geometry, and I5 fails `tracker-noisy-sanity` with a ratio of 5.83.
- **Geometry checks on generated data.** The geometry checks raised no false failure on 20,000
  scenarios from each of the phase-3 and held-out ranges.
- **Manoeuvre slice.** Its counts match the data.

### Round-2 minors and responses

**Geometry.**
1. _The straight-leg heading tolerance (2e-4 rad) has about 20% margin at the slowest, longest
   held-out tracks, because of float32 position rounding._ Recorded as a follow-up: a tolerance
   scaled to step and magnitude. Not changed now, because it would need a third G0 run for no
   change in outcome.

**Numerics.**
1. _N1 was half fixed in Annex B._ Fixed in bc8016b.
2. _The noisy check is one-sided._ It catches an under-stated variance, not an over-stated one.
   Now stated in `trackers.md`.
3. _A scale on R is a tuning lever._ Added to FR-011, and the gated tracker's straight-leg ratio
   is to be reported beside G4.

**Statistics.**
1. _The band labels the scenario, not the row._ FR-011 now requires G4 to score only rows at or
   after `manoeuvre_index` + the offset, with a unit test.
2. _`decided_by` is pending._ Set below.

**Reproducibility.**
1. _Ranges are recorded by digest only._ The paths are in this file's header.
2. _`decided_by`._ Set below.

**Red team.**
1. _Under noise, the IMM is not checked after the turn._ A mutation affecting only the turn
   model's noise passes. Carried into FR-011: a noisy post-turn sanity check before G4 is scored
   (the IMM at manoeuvre + 5 min against a batch fit on post-turn bearings, where an ownship zig
   follows the turn).
2. _Some re-convergence variants never converge._ 4 of the 24 are not within 5e-3, and the worst
   is non-converged. Carried into FR-011: the decision record declares how non-converged
   tracker rows count at G4 (as gross errors, they make G4-gross easier). The failing variants
   are listed by the research step (R2) rather than in this G0's detail line.

## Decision

**G0 passes on generator 0.4.0.** Panel rounds 1–2: no rejection, and no blocker or major finding
open. Training on generator-0.4.0 data may proceed under spec 010, once the decision record
(FR-011 items included) is committed.
