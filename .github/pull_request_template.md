## Summary

<!-- What changes and why. Cite the SRD section(s) and spec task IDs it implements. -->

## Constitution check

- [ ] Data types defined only in `schema/tma.yaml`; `pnpm schema:gen` run (I)
- [ ] Deterministic: seeded PRNG only; golden files updated deliberately, with the reason stated (II)
- [ ] `sim`/`features` stay pure functions; one CLI per stage; Keras-equivalent layers only (III)
- [ ] Any reported result sits beside naive and classical numbers on the same test set (IV)
- [ ] Respects the current gate: no training before G0, no scope beyond SRD §1 (V)

## Site pages

A PR that adds a concept, data type, algorithm or result must update the site.

- [ ] Glossary entry (`site/docs/glossary.md`) for any new term
- [ ] Data dictionary: regenerated automatically from the schema (nothing to edit)
- [ ] Algorithm note (`site/docs/algorithms/`) for any new or changed algorithm
- [ ] Blog post (`site/blog/`) for any new result or gate decision
- [ ] Not applicable: this PR adds none of the above

## Checks

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check && pnpm site:build`
