---
title: "caldir reached the same calendar-as-a-directory design; take its filenames, and note the provider gap"
workstream: unattached
area: beebox
labels: [calendar, connectors, prior-art]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked how it compares to what we do
---

[caldir](https://caldir.org/) ([t4t5/caldir](https://github.com/t4t5/caldir),
Rust, on crates.io) "stores your calendar as a directory of ICS files", synced
to providers with "git-like pull/push actions". Its stated reason is ours
exactly: calendars are "hidden behind APIs and proprietary sync layers", and
plaintext files let you "use tools like `grep` to search them, or set up
advanced workflows using scripts and agents".

This box already does that, and has since the calendar connector shipped:
one `.ics` per event in `_content/calendar/`, RFC 5545, round-tripped through
`ical.js`, bidirectional with Google
(`beebox/docs/calendar.md`, `beebox/src/connectors/google-calendar-*.ts`).
So the comparison is not "should we do this" — it is convergent evidence that
the choice was right, plus two things caldir does that we do not.

## Where we are further along

caldir's landing page does not describe recurrence, edits, deletions, or
conflict handling. Its `/commands` and `/providers` pages were not read, so
this is absence of documentation rather than proof of absence. Ours are built
and were paid for in edge cases:

- Recurrence stays one `.ics` with an `RRULE`, expanded at query time rather
  than on disk.
- The recorded content hash is the retry queue: a locally edited file whose
  bytes no longer match what the connector wrote is patched on the next sync,
  whether the edit is a minute or three syncs old.
- Nothing retries forever. A rejected push is retried for seven days from
  `pendingSince`, then the file is stranded into `_content/calendar/stranded/`
  with a `Stranded:` line naming the reason.
- A `410` expired sync token triggers a full-window refetch and
  reconciliation, with recurring masters deliberately exempt because an absent
  master is not evidence of deletion.
- The state file is an index, not a cache, so it is written atomically and a
  corrupt one refuses to sync rather than re-inserting every local event as a
  duplicate.

## Take: put the title in the filename

caldir names a file `2026-06-25T0900__dentist.ics`. We name it
`2026-06-25_a1b2c3d4.ics` — the date plus the last eight characters of an
opaque Google event id (`eventFilename`,
`beebox/src/connectors/google-calendar-ics.ts:323-330`).

That undercuts the whole reason for the format. `ls _content/calendar/` should
tell a person or an agent what is in there, and ours tells them nothing. A
`grep` for "dentist" finds the file by its `SUMMARY:` line, but every
directory listing, commit diff, and file-picker view is opaque.

Filed separately, with the implementation hazard it turned up:
[calendar .ics filenames should carry the event title](../features/2026-09-17-calendar-ics-filenames-carry-the-title.md).
Changing the name function is contained, but it makes every existing file
fall through to a fresh name on the next pull, against the design's stated
"no existing file is ever renamed" rule — so it needs a call on whether to
accept one rename pass.

## Note: the provider gap, and where it would strain

caldir supports Google, iCloud, Outlook, and generic CalDAV, and organizes by
provider directory (`google/`, `outlook/`). We support Google only — no
CalDAV, iCloud, or Outlook code exists anywhere in `beebox/src/`.

If a second provider is ever wanted, the place that strains is not the file
format but the index. Events are already keyed by `(eventId, calendarId)`
because a Google event id is unique only within one calendar
(`google-calendar-event-index.ts`); a second provider adds a third axis, and
the flat `_content/calendar/` directory is where caldir's per-provider
subdirectory starts to look right. Worth knowing before that work starts, not
worth doing now.

Not proposed: adopting caldir itself. It would mean giving up the retry
queue, the stranding bound, and the failure reporting listed above, which are
the parts that took the real work. Its provider adapters are the part worth
reading if CalDAV ever gets built here.

## Also found: the calendar doc is wrong about our own filenames

`beebox/docs/calendar.md` says under Storage that events live in
"individual `.ics` files ... with human-readable slugged filenames" and shows
`Weekly_team_standup.ics` and `Dentist_Feb_20.ics`. The code has never
produced that shape. The same document states the real convention correctly
further down (`{YYYY-MM-DD}_{shortId}.ics`), so the Overview section is stale
against its own detail section. Fix that whether or not the filename change
above happens.
