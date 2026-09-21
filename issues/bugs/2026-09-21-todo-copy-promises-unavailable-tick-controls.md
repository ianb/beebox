---
title: "Todo card copy promises tick controls that the v1 renderer cannot provide"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — F newcomer journey
---

The authored todo card says “Tick them off as they're done”, but the current
`{% todo %}` renderer and the Plate are explicitly read-only. A newcomer sees
the promise, then must type a chat request to change `status`. This is a narrow
copy and capability mismatch; adding interactive controls would be a separate
design choice.

## Research (2026-09-21)

- `beebox/src/frontend/src/components/Todo.tsx:5-8` documents “read-only
  rendering in v1 — no click-to-toggle”.
- `beebox/src/frontend/src/components/TodoViewCard.tsx:5-9` documents the Plate
  as read-only with “no click-to-done in v1”.
- F's persisted `_content/todos/Household_Jobs.doc.card:6` contains the
  “Tick them off” sentence. Screenshots 09 and 10 show no controls beside the
  three todos.

The fix could change the authored guidance to match the current interaction or
make the controls real. Do not clear the broader todo rendering manual-test
gate based on this report.

Evidence: [journey F report](../../beebox/user-stories/journeys/F-newcomer/reports/2026-09-21.md).
