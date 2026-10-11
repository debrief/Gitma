# TMA via ML

Can a neural network trained on large volumes of simulated bearings-only data produce usable target
range, course and speed estimates? This repository is a TypeScript proof of concept that answers
that question through a series of go/no-go gates. It is not a product.

- **Site**: https://debrief.github.io/Gitma/ (gate status, blog, glossary, data dictionary, algorithms)
- **Requirements**: [`docs/SRD.md`](docs/SRD.md)
- **Principles**: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- **Current work**: [`specs/`](specs/) (Spec Kit). Walkthroughs: iteration 0
  [`quickstart.md`](specs/001-iteration-0-pipeline/quickstart.md), iteration 1
  [`quickstart.md`](specs/002-iteration-1-signal/quickstart.md) (training, `tma-g1`)
- **Contributing / agents**: [`AGENTS.md`](AGENTS.md)

## Status

| Gate                   | Result                                                         | Evidence                                                               |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| G0 — pipeline verified | pass (agent review panel, round 3)                             | [`experiments/20261011-g0-r3`](experiments/20261011-g0-r3/review.md)   |
| G1 — signal exists     | training (iteration 1, GitHub Actions); panel review to follow | [`specs/002-iteration-1-signal`](specs/002-iteration-1-signal/spec.md) |

## Quick start

Requires Node 22 (`.nvmrc`), pnpm and [uv](https://docs.astral.sh/uv/).

```
pnpm install && uv sync && pnpm build
pnpm test
pnpm tma-generate --seed 42 --count 100000 --noise-free --out data/g0
pnpm tma-g0 --data data/g0 --experiment experiments/my-g0
```

All data is simulated; nothing above OFFICIAL belongs in this repository.
