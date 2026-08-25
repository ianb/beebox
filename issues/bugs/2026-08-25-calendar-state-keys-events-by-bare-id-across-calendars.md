---
title: "Calendar state keys events by bare event id across calendars"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-connector-integrity — cross-model review of the 410 stale-removal pass
priority: normal
---

**What is wrong.** `eventFiles` in `callback-box/src/connectors/google-calendar-state.ts`
is keyed by `event.id` alone. Every consumer — `reconcileEvent` in
`google-calendar-sync.ts`, `pushAndCleanOrphans`/`processLocalDeletes` in
`google-calendar-push.ts`, and the post-410 stale pass in
`google-calendar-stale.ts` — looks entries up by that bare id. Google event ids
are unique within a calendar, not across calendars, so a box syncing two
calendars can hold two events with the same id.

**Consequence.** The second calendar's event is read as the tracked entry for
the first's file: an update or cancellation on one calendar can overwrite or
delete the other's `.ics`. The stale pass filters by `entry.calendarId`, which
narrows the damage but does not fix the keying.

**Fix shape.** Key `eventFiles` by `(calendarId, eventId)` — a joined string is
enough — with a migration of existing state files. Doctest: two configured
calendars, one shared event id, distinct files survive a sync of each.
