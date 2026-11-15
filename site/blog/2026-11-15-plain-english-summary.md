---
title: "The project in plain English: can AI track a ship from bearings alone?"
date: 2026-11-15
---

A non-technical summary of what this project set out to do, what it found, and what it means. The
full, technical answer is the [go/no-go report](/docs/results/go-no-go).

## The question

A submarine listening to a ship hears only which direction the sound comes from, not how far away
the ship is. Working out the ship's range, course and speed from those directions alone is a
classic problem called target motion analysis. Well-established mathematical methods already
exist for it.

We asked whether an AI model, trained on large amounts of computer-simulated data, could do the
job well enough to be useful.

## How we worked

Every step was set up as a fair test:

- the rules were written down before the test ran;
- the score came from fresh data the model had never seen;
- the AI was always compared with the existing mathematical methods.

Each result was then checked by a panel of AI reviewers.

## What we found

- **The AI does learn something real.** It clearly beats guesswork, and it is good at judging how
  far away the ship is.
- **On its own, it isn't good enough.** When the ship sails straight, the traditional methods are
  1.6 to 3.5 times more accurate, especially on speed. The AI never caught up, despite many
  attempts.
- **It shines where the traditional methods struggle.** That is in the minutes just after the ship
  turns, and when the direction measurements carry realistic, drifting errors.
- **The best result combines the two.** Feeding the AI's range estimate into a traditional tracker
  made it 18–23% more accurate on range than the tracker alone.
- **A final check measured the theoretical best possible accuracy.**
  - On straight legs, the traditional method already reaches that limit, and the AI is about 1.5
    times worse.
  - After the ship turns, it is still unknown how much better anything could do.

## The verdict

- **No:** the AI should not replace the traditional methods.
- **A qualified yes:** it is worth using as a helper inside a traditional tracker, mainly for
  judging range and for coping after the ship turns.

## What would come next

The next step is testing on real or more realistic data, against a traditional tracker tuned for
those conditions. That cannot happen here, because this project is public and uses simulated data
only.

## Honest caveats

- **Everything is simulated.**
- **Some rules were relaxed along the way.** That always happened before the affected result was
  known, but it still matters.
- **The reviewers were not fully independent.** They were AI agents of the same family as the
  one doing the work.

None of these changes the main "no".
