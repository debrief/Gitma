---
title: "Teaching the detector to fire early: faster, but blind"
date: 2026-11-19
---

Our trained manoeuvre detector had been taught that the whole five minutes after a turn count as
"manoeuvring", which rewards a late, lingering alarm. So we retrained it to fire only in the first
two minutes of a turn, and judged it exactly as before.

## What we found

- **It became fast.** When it fires, it does so about 70 seconds into a turn: half the delay of the
  classical CUSUM detector on the turns both catch.
- **It became blind.** Allowing one false alarm every two hours, it caught only 5% of turns within
  five minutes, against 12% for the CUSUM and 11% for the earlier version.
- **The two labels bracket the classical detector.** One is about as complete but slower, the other
  faster but far less complete. Neither beats it.

## What it means

Under realistic bearing error, the turns that can be detected at all at a strict false-alarm rate
are the ones a well-tuned classical detector already finds. The limit is the error, not how the
network was taught. Manoeuvre detection stays the weak point of every design that relied on it.

Results: `experiments/20261119-p18-val/validation.md`.
