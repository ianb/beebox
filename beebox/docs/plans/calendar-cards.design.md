---
title: "Calendar cards: design"
status: draft
workstream: calendar-cards
issues:
  - ../../../issues/features/2026-10-10-a-calendar-is-a-card-with-its-events-under-it.md
  - ../../../issues/features/2026-09-17-calendar-ics-filenames-carry-the-title.md
---
# Calendar cards: design

**Parent plan:** [calendar-cards](calendar-cards.md)

Boxholder decisions (2026-10-29): events stay `.ics` files; each synced
calendar is one card with its events in the card's attach folder; existing
event files are renamed and moved once.

```
_content/calendar/
  Family.calendar.card
  Family.attach/
    2026-06-25_Dentist_a1b2c3d4.ics
    2026-07-02_Juni_swim_meet_44bb01aa.ics
    stranded/
  GRS_School_Calendar.calendar.card
  GRS_School_Calendar.attach/
    ...
```

## Situations

- When Priya opens the box at lunch and wonders what is on the family
  calendar this week, I want to open the Family calendar and see the coming
  events by day and title, so I can answer Tomas without opening Google.
- When Tomas reads a sync commit or a chat answer that names an event file,
  I want the path to say which calendar and which event, so I can tell
  "Juni's swim meet moved" from a line of ids.
- When the box's agent is asked "when is Odette's next appointment?", I
  want it to find the calendar by name and the event by filename, so I can
  get an answer that points at a file I can open.
- When Priya wants to add a dentist visit from inside the box, I want to
  drop an event into the Family calendar's folder, so I can have it reach
  Google on the next sync without naming the calendar inside the file.
- When Tomas syncs a school calendar he only reads, I do not want the box to
  invite edits that Google will refuse, so I can trust that what the card
  shows is what Google holds.
- When Priya is browsing her notes, she does not want 116 event files in
  the way; the calendar folder should be six cards she can ignore.

## Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| This week's events | Show | Calendar card page: upcoming events from today, grouped by day | Waits to be found |
| Readable paths | Show | Event filenames everywhere a path appears (listing, commit, chat) | Background |
| Agent lookup | Show | Calendar card fields and schema instructions; filenames | Background |
| Add an event | Act on the next sync | The calendar's attach folder; the sync commit names it | Background; the commit says what was sent |
| Read-only calendar | Show | Calendar card states "read-only in Google" | Waits to be found |
| Not wanted | Quiet | `_content/calendar/` lists one card per calendar | None |

The rename and move happen once, in the migration commit. Nothing about it
interrupts; the commit message says what moved and why.

## Spirit

- **Serves:** "You should be able to see the gears." A calendar is files a
  person and an agent can list, read, and diff, and their names say what
  they are.
- **Serves:** "It should feel like a place." Each calendar is a thing in the
  box with a name and a page, not a directory of opaque files.
- **Risks:** "See the gears", again. Moving 116 files in one commit makes
  history harder to follow for those files. Guard: the migration is one
  commit with only renames (git shows them as renames), and its message
  names the rule change.

## Trust

The design adds no new action. Two existing actions change place:

- **Push of a new local event.** Today a new `.ics` goes to the calendar
  named by `X-BBX-CALENDAR-ID` in the file, or to the first configured
  calendar. With this design the folder names the calendar, so a file dropped
  into `Family.attach/` is pushed to Family. This stays automatic, as it is
  today; the sync commit records each push. A push Google refuses is reported
  on every sync and the file stays where it is, as today.
- **Card fields.** The connector writes and rewrites the calendar card's
  fields from Google on each sync. The card's body is the person's; the
  connector never writes it.

The migration runs once per box with no question. It only renames files;
the event contents and the index are kept.

## When it goes wrong or does nothing

- **No events in the window.** The card says "No events between Oct 29 and
  Nov 28" (the next 30 days), so an empty list reads as a fact, not a fault.
  A folder that cannot be read shows an error, never an empty list.
- **A read-only calendar edited locally.** The card says it is read-only.
  If a person edits a file anyway, the sync reports the refused push and
  strands the file after seven days, as today; the stranded file sits in
  that calendar's `stranded/` folder.
- **A calendar renamed in Google.** The card title follows Google; the card
  file and folder keep their first name, because a rename would move every
  event file again. The card shows the Google name.
- **A calendar removed from the sync set.** Its card and folder stay and
  nothing is deleted. The card says "Not pulled from Google": Google's changes
  stop arriving, while edits made in the box are still sent, as today.
- **An event whose title has no usable characters** (empty, emoji only).
  The filename falls back to `{date}_{shortId}.ics`, the current shape.
- **A file without a calendar folder** (left at the top of
  `_content/calendar/` after the migration, or dropped there by a person).
  The sync reports it as a failure naming the file and the folders it could
  go in. It does not guess a calendar.

## Walkthrough

Priya adds a dentist visit.

1. In chat she says "put the dentist on the family calendar, Thursday at
   3." The agent reads the calendar card instructions, finds
   `Family.calendar.card` (title "Family", role owner), and writes
   `Family.attach/dentist.ics` with a `SUMMARY` and `DTSTART`. Any name
   works; the sync renames it.
2. On the next calendar sync the push pass finds an untracked file in the
   Family folder and inserts it into the Family calendar in Google.
3. The sync commit says "Pushed: Dentist (Nov 5)". Priya opens the Family
   card and sees Thursday's entry under that day; clicking it opens the
   file.
4. On the following sync, Google returns the new event and the pull renames
   the file to the standard name (`2026-11-05_Dentist_k3j9q2aa.ics`). That
   commit shows the rename.
