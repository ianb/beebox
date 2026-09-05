---
title: "Two calendars can still collide on one .ics filename"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-integrity — keying calendar state by (event, calendar)
resolution: implemented
---

**Closed — fixed in the same pass that keyed the index by (event, calendar).**
`uniqueEventFilename` in `beebox/src/connectors/google-calendar-event-index.ts`
disambiguates the name with a short hash of the calendar id when a pull is about
to write a file another entry already holds, and keeps a disambiguated name as
long as it still describes the event. No existing file is renamed, so the rename
migration this item feared is not owed. A box that already has two entries on one
file is deduped once per sync (`dropDuplicateFilenames`): the first entry keeps
the file, the later one is untracked and reported as a sync failure. Covered by
`beebox/test/connectors/google-calendar-event-index.doctest.md`.

**What is wrong.** `eventFilename` in
`beebox/src/connectors/google-calendar-ics.ts:323` builds a file name from
the event's start date plus the last 8 characters of its id:
`{YYYY-MM-DD}_{shortId}.ics`. The calendar is not part of it. Two calendars can
hold different events with the same id (Google event ids are unique within one
calendar only), so two events that also share a start date produce the SAME file
name.

**Consequence.** The index now tracks the two events separately — the key is
`<eventId> <calendarId>` since
[the bare-id keying fix](2026-08-25-calendar-state-keys-events-by-bare-id-across-calendars.md)
— but both entries name one file. The calendar synced second overwrites the
first's `.ics`, and the first's entry then points at content that is not its
event: a later local edit is pushed to the wrong calendar's event, and a
cancellation deletes a file the other entry still claims.

**How it was fixed.** Disambiguate only on collision, and only for a file about
to be written — which is what makes it free of a rename migration. The name is
deterministic (a hash of the calendar id, not a counter), so it does not depend
on sync order, and a disambiguated name is kept while it still describes the
event so the file is not renamed back and forth as its partner is cancelled and
re-created.

**Reachability.** It needs the same id on two synced calendars AND the same
start date. The same-id half is ordinary (a shared invite copied between
accounts); the same-date half makes it much rarer.
