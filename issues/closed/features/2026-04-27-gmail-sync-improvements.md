---
title: "gmail sync improvements"
workstream: unknown
area: callback-box
resolution: implemented
---

**Closed:** Fully implemented: uncapped Gmail-id dedup checked before fetch, no date filters, incremental sync via the history API with full-list fallback, and baseline no-import first sync for the bare `label:inbox` default (`src/connectors/gmail-pull.ts`). The remaining garbage-collection piece (below) also shipped. See `docs/connectors.md` and `docs/implemented-plans/gmail-gc-unlabeled.md`.

*(Implemented 2026-06: uncapped Gmail-id dedup checked before fetch, no date filters, incremental sync via the history API with full-list fallback, baseline no-import first sync for the bare `label:inbox` default. See `src/connectors/gmail-pull.ts`.)* Remaining:

### Garbage-collect unlabeled messages — IMPLEMENTED (2026-06)

When a thread loses its triggering label in Gmail, a cadence-gated
reconciliation pass full-lists current matches, diffs by Gmail thread id, and
withdraws the still-pending inbox card to `store/trash/`. Safety rests on
"location is state" — only cards still in `box/inbox/email/` are candidates, so
anything an agent already acted on is untouched. See
`src/connectors/gmail-gc.ts`, `docs/connectors.md`, and
`docs/implemented-plans/gmail-gc-unlabeled.md`. (Chose full reconciliation over
the `labelsRemoved` incremental signal — message-granular and lossy across
history gaps.)
