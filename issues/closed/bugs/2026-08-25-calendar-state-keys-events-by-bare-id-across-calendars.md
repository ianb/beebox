---
title: "Calendar state keys events by bare event id across calendars"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-connector-integrity — cross-model review of the 410 stale-removal pass
priority: normal
resolution: implemented
---

**Closed 2026-08-25.** `eventFiles` is keyed by `"<eventId> <calendarId>"` (`google-calendar-event-index.ts`: `eventKey`/`parseEventKey`); `reconciledEventKeys`/`seenEventKeys` use the same keys. State files migrate on load (`version: 2`), legacy plain-string entries sit under `(legacy)` until a pull adopts them. Colliding filenames across calendars get a calendar-hash suffix. Doctests: `test/connectors/google-calendar-event-index.doctest.md`.

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

**Also affected (2026-08-25).** `reconciledEventIds` in the sync accumulator
(`google-calendar.ts` / `google-calendar-local-push.ts`) is keyed the same way:
a pull of calendar A can mark id `X` reconciled and make the pending-edit pass
skip a locally edited `X` tracked for calendar B. Fix together.
