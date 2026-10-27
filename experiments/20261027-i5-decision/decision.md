# Iteration 5 decision: G3 for the hybrid (decision 24)

Committed before any seed-207 data exist. Spec: `specs/009-iteration-5-hybrid/`.

## The change

Nothing is trained. The estimator is the **hybrid**: classical's least-squares estimate,
replaced by the frozen iteration-4 instantaneous LSTM's where the two disagree.

- **The rule** (`hybridSwitch`, `SWITCH_RANGE_REL` 0.5). Per timestep, report classical's row
  unless classical has no converged, plausible estimate, or |r_classical − r_network| / r_network
  > 0.5; then report the network's row.
- **Its name and claim.** It is reported as `hybrid-lstm-instantaneous`. It is a hybrid result
  (Annex A B.2.6), not "a network alone".

## Why

Research is in `specs/009-iteration-5-hybrid/research.md`.

- **R1.** The per-leg fit (B.2.3) gives no usable range rate on the young legs at the gate
  points.
- **R2.** A network-initialised solver gives classical's answer in all but 0.13% of rows.
  Classical's gross errors are the least-squares optimum itself lying far from the truth: the
  true state had the lower cost in 1 of 2,379 gross rows. The LSTM was within 50% in 91% of
  those rows.
- **R3** (seed 205 validation, σ = 1°). The switch keeps classical's accuracy. Every median and
  P90 is within 1.03 × classical. At zig + 300 s, gross errors fall from 1.25% to 0.55%.

## What is scored

- **Network.** `experiments/20261023-i4a-val/models/lstm-instantaneous`. Its weights.bin,
  manifest.json and model.json SHA-256 are in `decision.json`. It is scored with its own
  normalisation, from its manifest, on the derived feature set.
- **Classical.** `tma-solve --per-timestep` with default options, unchanged.
- **Test data.** Seed 207's test split, 20,000 scenarios:
  - indices 180,000–199,999 of a 200,000-scenario dataset;
  - `configs/iter4-ranges.json` and `configs/iter4-heldout-ranges.json`, generator 0.3.0;
  - `scripts/generate-splits.mjs --splits test`, from a clean tree.

  The content digest (`train-plan.mjs digest`) is recorded in the experiment's `review.md`
  before scoring. Seed 207 is reserved.
- **Reported beside it** (FR-008). Naive (fitted on seed 205's train split), classical and the
  LSTM, by `tma-eval` on the same rows, and the share of rows switched.

## What decides (G3, SRD §5; spec 009 FR-007)

`tma-g3 --decision` on the σ = 1° slice, with paired bootstrap 95% intervals (2,000 resamples,
seed 20261011) and FR-015:

| Check | Statistic | Limit |
| --- | --- | --- |
| range median, range P90 (zig + 300 s) | hybrid / classical | 1.2 |
| course median, course P90 (zig + 300 s) | hybrid / classical | 1.2 |
| speed median, speed P90 (zig + 600 s) | hybrid / classical | 1.2 |
| gross-error rate (zig + 300 s) | hybrid − classical | 0 |

- **Pass** needs all seven checks to pass. Any fail is a fail; anything else is inconclusive.
- **Not a stop condition** (SRD §5). The panel of §8 decides.
- **Position error** (time-late) is not part of G3 here (FR-009).

## Validation rule (Annex A B.3.3; spec 009 FR-006)

The same seven checks on seed 205's validation split (`tma-g3`, diagnostic) must show:
- every ratio passing;
- the gross-error interval wholly below 0.

Otherwise the iteration stops at validation. The diagnostic is recorded in research R3 before
this record is committed.

## Forecast

- **Ratios.** Median and P90 ratios of 0.99–1.03; all six ratio checks pass.
- **Gross errors.** At zig + 300 s the gross-error rate falls from about 1.2% to about 0.5–0.6%.
  At 20,000 scenarios (about 9,900 σ = 1° rows at zig + 300 s), the difference's interval is
  about ±0.2 pp, so it lies wholly below 0.
- **Probability.** P(G3 pass) about 0.9. The main risk is the gross-error check, if seed 207's
  classical failures are rarer or the network fails more often there.

## How it is run

Locally, once, from a clean tree. The run is about 1 h at 20,000 scenarios, inside one
container's life.

1. Generate seed 207's test split, then record its digest.
2. Build derived features with the LSTM's normalisation.
3. Run `tma-model-predict`, `tma-solve --per-timestep` and `tma-naive` (seed 205's train split).
4. Run `tma-hybrid`.
5. Run `tma-eval` (report).
6. Run `tma-g3 --decision experiments/20261027-i5-decision/decision.json --experiment
   experiments/<date>-i5-g3`.

Every invocation is recorded in the experiment's `review.md`.
