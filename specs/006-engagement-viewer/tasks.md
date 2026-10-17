# Tasks: Engagement and model viewer

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

## Setup PR

- [x] T001 SRD amendments from Annex A §B.4 (§4, §6, §7, §8 decision 21); AGENTS.md
- [x] T002 Spec 006 (spec, plan, tasks)

## Implementation PR

- [ ] T003 Browser-safe subpaths: `@tma/features/browser` (with `decode.ts` moved from models),
  `@tma/classical/browser`, `@tma/data/canonical`; goldens unchanged
- [ ] T004 `@tma/demos` core: catalogue types, `scenarioAt`, geometry, inference glue, errors,
  classical and naive rows, URL state, NDJSON export
- [ ] T005 Tests: browser bundle (FR-001), agreement (FR-007), golden, server render
- [ ] T006 React viewer: controls, plan view, time plots, panels, three modes, model choice,
  overlays, PNG and NDJSON export, URL state
- [ ] T007 Site: prebuild catalogue and model copy, `/viewer` page, navbar link, featured bookmarks
- [ ] T008 Playwright smoke on the built site; screenshots
- [ ] T009 Blog post with linked views (SC-003); site pages (algorithm note on the viewer)

## Owner

- [ ] T010 Realism check (Annex A §A.5) and its record (§A.7)
