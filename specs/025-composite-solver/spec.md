# Spec 025: the composite solver (gate G9)

**Requirements:** SRD Annex D (owner decisions D1–D4, 2026-11-15); spec 024 (the information
limit); specs 014 (the fused tracker) and 015 (gate bindings).

## Goal

Keep each estimator where it is strongest:

- batch least squares on straight legs, where it reaches the Cramér–Rao bound;
- the frozen fused tracker once the target has manoeuvred.

A least-squares fit check switches between them. The composite is judged by G9: better than the
fused tracker overall, and within 1.1 × of least squares on straight legs, under realistic bearing
error.

## Functional requirements

- **FR-001 Estimator.** `compositePredict` (`@tma/classical`) and `tma-composite`.
  - It follows the fit check and latching switch of Annex D §D.1.
  - It is named `composite-classical-<fused>-w<W>-c<c>`, and `parseCompositeName` round-trips the
    name.
  - Its prediction files record both inputs by SHA-256.
- **FR-002 Least squares at scale.** `tma-solve` streams its output and takes `--workers n`. The
  output is byte-identical to a single thread's.
- **FR-003 Gate.** `tma-g9` runs the checks and verdict of §D.3 (`gate-g9.ts`, schema 0.23.0
  `GateId` G9).
  - On a test split it applies spec 015's bindings, including the re-computation of the
    composite, the fused tracker and least squares (`recompute.ts`).
  - It refuses a composite whose inputs are not the files given.
- **FR-004 Validation.** The §D.2 grid on seed 217 (`scripts/research/spec025-grid.mjs`,
  `experiments/20261115-p12-val/run.sh`), committed before it runs.
- **FR-005 Decision 41.** Committed only if a variant is carried, before seed 229 is generated.
  It freezes:
  - the chosen W and c, as the composite's name;
  - the fused tracker as the reference;
  - the frozen T2 by digest;
  - the plans;
  - test seed 229.
- **FR-006 Panel and write-up.** The panel judges G9 on seed 229. The write-up covers the SRD
  outcome, AGENTS.md, a blog post and the algorithm note.

## Out of scope

- Training, and changes to either input.
- Returning to least squares after a switch, or fitting a new leg after a manoeuvre.
- Other error models.
