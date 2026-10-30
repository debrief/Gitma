# Spec 012: Phase 4 — end-to-end learned trackers

**SRD trace:** Annex C (all sections); main body §2, §3, §4, §5, §7, §8 as amended by Annex C §C.7;
constitution 1.3.0 principle III (declared filter layer).
**Owner decisions, 2026-10-30 (decision 28):**
- build two trackers, a learned-gain filter and a pure recurrent tracker, and compare them;
- train and judge them on 0–3 course changes and an occasional speed change;
- gate G5: better overall than the re-tuned reference, at most 10% worse on settled rows;
- if G5 fails, the follow-on is decided when the result is known.

## Why

Phases 3 and 3b showed a network beating the tuned IMM after one turn but losing to it on held
course (Annex C §C.1). An end-to-end tracker, trained where manoeuvres are the norm, is the
separate project Annex B §B.5 named.

## Requirements

- **FR-001 (generator 0.5.0, schema 0.15.0).** As Annex C §C.2, amended while implementing.
  - **Windows** are 20–60 min.
  - **The count** is drawn once per scenario from its own stream and kept through redraws.
  - **Manoeuvres never overlap.**
  - **Metadata.** `manoeuvres` holds each manoeuvre's kind and span; `manoeuvre_start_index` is
    the first manoeuvre's start and `manoeuvre_index` the last one's end.
  - **Compatibility.** Older ranges reproduce 0.4.0's scenarios byte for byte.
- **FR-002 (G0).** Re-run G0 on 0.5.0 noise-free data (seed 42, 100,000 scenarios), with:
  - known answers for a speed change and for two turns;
  - step-by-step target kinematics;
  - the timing rules and speed bounds;
  - the existing checks on each scenario up to its first manoeuvre (`beforeManoeuvre`).

  An agent panel decides.
- **FR-003 (references).** Re-tune the IMM and the EKF on phase-4 validation over all G5 rows, and
  freeze the better one before training (Annex C §C.3).
- **FR-004 (trackers).**
  - **T1:** a learned-gain filter in a declared filter layer. With a fixed gain, it must reproduce
    the EKF.
  - **T2:** a pure recurrent tracker with a per-output log-variance (Gaussian NLL).
  - **Before the decision record:** each tracker's training cost is measured, and both are
    declared in the record.
- **FR-005 (G5).** `tma-g5` implements Annex C §C.5:
  - rows at zig + 5, 10, 15 and 20 min;
  - the scenario-clustered paired bootstrap;
  - 97.5% intervals per tracker;
  - the overall and settled checks;
  - the validation rule;
  - one re-score.
- **FR-006 (reporting).**
  - **Beside every tracker figure:** naive, batch least squares, both references, and phase 3's
    networks where applicable.
  - **Slices:** manoeuvre count (`manoeuvre=…`), settled against unsettled, and time since the
    last manoeuvre.
  - **Calibration** of T2's uncertainty, reported only.

## Success criteria

- **SC-001:** G0 passes on 0.5.0 with a panel review before any training.
- **SC-002:** the decision record is committed before training.
- **SC-003:** one validation look per tracker, then at most one test scoring and one re-score.
- **SC-004:** the write-up states the outcome against Annex C §C.6, including that the failure
  branch was left open.
