---
title: "Re-arming the composite solver makes it worse"
date: 2026-11-15
---

The first composite solver almost passed: it missed its gate by 1.3% on course. Its weakness
seemed clear. Once it handed over to the fused tracker after a manoeuvre, it never came back to
least squares, even when the target settled on a new straight leg.

The owner chose to let it **re-arm**:

- after a switch, fit a new straight leg, borrowing the fused tracker's range to pin it down;
- hand back to that leg once it is a few minutes long and fits the bearings well.

## Result: worse, not better

- **The score.** The best re-armed setting scores −0.031, against −0.013 for the original. It
  fails overall course against the fused tracker (1.034).
- **The pattern.** Every setting does worse than without re-arming, and handing back sooner does
  worst.

## Why

- **The new legs look right but aren't.** Where the composite uses one, it is about twice as
  wrong as the fused tracker on the same rows: range 31% against 16%, speed 5.9 kt against
  3.0 kt.
- **A good fit isn't a right answer.** Without the listening platform manoeuvring again, many
  different tracks explain a short leg's bearings equally well. Borrowing the range fixes the
  distance but not the velocity. This is the basic limit of bearings-only tracking, and it is
  why least squares needs an ownship manoeuvre in the first place.
- **The real cost is unchanged.** 44% of the rows after a manoeuvre still come from the stale
  least-squares answer before the switch trips. Re-arming does nothing for those.

## What it means

Both composite designs are recorded as failing their gate on validation. No test data were
generated. The lesson is narrow: a residual check can say when a straight-line fit has broken,
but not when a new one is trustworthy.

Record: `experiments/20261115-p12b-val/`; SRD Annex D §D.7–D.8; spec 025.
