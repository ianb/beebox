---
title: "connector transient state rmw"
workstream: unknown
resolution: implemented
---

**Closed 2026-07-09:** all eight RMW spans now run through
`updateTransientState` (dual in-process + cross-process locking, fresh-state
delta semantics) — helper in c1e65a22, telegram sites in 5c93f7a9,
gmail/drive/calendar sites in 5dcd611e. Plan:
`beebox/docs/implemented-plans/architectural-review-followups.md` Track 1.

Surfaced by the Track H card-locking work (codex review finding, deliberately
deferred). Telegram's `processWebhookUpdate` and two sibling methods
(`telegram.ts` ~156/287/364) do read→mutate→write on `*.state.json` without
`withCardLock`, and other connectors' transient-state files share the
pattern. Wrapping just the one method pushed telegram.ts past the 300-line
cap and only covered a third of the instances — this wants one deliberate
pass over connector transient state, not a drive-by.

The helper already exists (`src/lib/card-lock.ts`); the work is the audit +
wrapping + possibly extracting the telegram state IO into its own module to
stay under the line cap. Track D/connector territory in
`docs/implemented-plans/architectural-review.md`.
