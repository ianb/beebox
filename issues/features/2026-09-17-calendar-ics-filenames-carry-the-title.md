---
title: "Calendar `.ics` filenames should carry the event title, not eight characters of Google's event id"
workstream: unattached
area: beebox
needs: [decision]
labels: [calendar, connectors]
filed-by: agent
discovered-by: Ian
discovered-in: main — comparing against caldir, which names files by date and title
---

An event file is named `{YYYY-MM-DD}_{shortId}.ics`, where `shortId` is the
last eight characters of the Google event id (`eventFilename`,
`beebox/src/connectors/google-calendar-ics.ts:323-330`). So a directory of
events reads:

```
2026-06-25_a1b2c3d4.ics
2026-06-25_9f0e1d2c.ics
2026-07-02_44bb01aa.ics
```

The point of storing a calendar as a directory of plaintext files is that a
person or an agent can look at it. `grep dentist` finds the file by its
`SUMMARY:` line, but `ls`, a directory listing in the app, a commit diff, and
every path that appears in a chat or a log tell nobody anything. Every other
card in a box carries a readable name (`Meeting_Notes.memo.card`), so the
calendar is the outlier, and the sensitivity argument for opaque names was
already settled the other way box-wide.

[caldir](https://caldir.org/) names the same file `2026-06-25T0900__dentist.ics`.
See [the comparison](../exploration/2026-09-17-caldir-calendar-as-a-directory.md).

## Shape

`{YYYY-MM-DD}_{slug}_{shortId}.ics`. The date stays first so the directory
sorts chronologically. The slug comes from `SUMMARY` through
`sanitizeFilenameStem` (`beebox/src/shared/filename.ts`), which already caps
length and strips separators. The short id stays, because two events can share
a day and a title, and because the calendar-id disambiguator appends after it.

Do not add caldir's time component. All-day events have no time, and the
suffix would have to be conditional for no gain over the slug.

## The thing that will bite: this renames every existing file

`eventFilename` has one caller
(`beebox/src/connectors/google-calendar-sync.ts:209`) and nothing parses the
name back, so the change itself is contained. The hazard is downstream.

`uniqueEventFilename` keeps an event's current name only when that name equals
the freshly computed natural name, or extends it with a disambiguator suffix
(`beebox/src/connectors/google-calendar-event-index.ts`). Change what the
natural name is and neither test matches for any existing event, so every
tracked file falls through to a fresh computation. The sync then unlinks the
old file and writes the new one, which is the path a genuine date change
already uses.

That contradicts the design rule stated in the same module and in
`beebox/docs/calendar.md`: **no existing file is ever renamed, so no rename
migration is owed.** Changing the convention silently breaks that promise on
the next pull of every box.

**The decision.** Two ways, and this needs a human call:

1. **Accept one rename pass.** Every event file is renamed once, in one noisy
   commit per box, and the box is uniform afterwards. The index is rewritten
   on the same code path, so nothing desyncs, and the rename path is already
   exercised by date changes rather than new. The cost is a large one-time
   diff and a stated rule that now has an exception with a date on it.
2. **Keep existing names.** Loosen the keep-current test to compare only the
   date and short id, so old files stay and only new events get readable
   names. The rule holds, but the box carries two conventions forever, and
   the events you already have are the ones you most want to recognize.

Lean: option 1. The opaque names are the problem, and a fix that leaves every
existing event opaque fixes almost nothing on an established box.

## Check before implementing

- A rename while a local edit is pending. The pull's local-wins path reads
  `oldName` before deciding (`google-calendar-sync.ts`), so confirm a pending
  unpushed edit survives a rename in the same sync, and add a doctest for it
  if none covers that pair.
- The disambiguator. A name that already carries a calendar-id hash must not
  gain a second one; the suffix test runs against the new stem, so re-check it
  against a file named under the old convention.
- `beebox/docs/calendar.md` needs updating either way. Its Overview already
  claims "human-readable slugged filenames" and shows examples the code has
  never produced, which is how this was found.
