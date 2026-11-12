# Calendar

Google Calendar synced two-way: one `calendar` card per calendar in `_content/calendar/`, its events as `.ics` files in the card's attach folder.

## What it is

**Status: Implemented (bidirectional).** Google Calendar ↔ `.ics` files under `_content/calendar/`. Pull is the well-exercised path; local edits, locally-created events, and `x-bbx-DELETE` markers are pushed back to Google during sync. Caveats: scheduled auto-sync is disabled by default, and the push path has little real-world mileage.

Google Calendar sync into `.ics` files as the canonical local store. Events are pulled on each calendar connector sync; the CLI surfaces them via `bbx calendar`. No realized monthly card views — queries are CLI-driven.

## Storage

Each synced calendar is a card, `_content/calendar/<Name>.calendar.card`
(`src/schemas/calendar.tsx`), and its events are `.ics` files in the card's
attach folder, one per event, named `{YYYY-MM-DD}_{title}_{shortId}.ics`:

```
_content/calendar/
  Family.calendar.card
  Family.attach/
    2026-06-25_Dentist_a1b2c3d4.ics
    2026-07-02_Weekly_team_standup_44bb01aa.ics
    stranded/
  School.calendar.card
  School.attach/
    ...
```

The date leads so a folder sorts by date; the title comes from `SUMMARY`
through `sanitizeFilenameStem` (40 characters); the short id is the last
eight characters of the Google event id and keeps two same-day, same-title
events apart. An event with no usable title is `{date}_{shortId}.ics`. There
is no time component: all-day events have none.

**The folder is the calendar.** The connector reads the cards on every sync
to map each calendar id (`google-calendar.id`) to its folder, so a card renamed
together with its folder needs no other change. It creates a card for a
configured calendar that has none (named from the Google name, fixed from then
on), and re-stamps `title` and `google-calendar:` (`access`, `syncing`) on
every sync; the body and any other field are the person's. A new `.ics` in a
folder is pushed to that folder's calendar. Problems are reported, never
guessed: an `.ics` directly in `_content/calendar/`, a file whose
`X-BBX-CALENDAR-ID` names a different calendar than its folder, two cards
naming one calendar, or a calendar with tracked events and no card. A
calendar removed from the sync set keeps its card (`syncing: false`): Google's
changes stop arriving, while edits made in the box are still pushed.

**Files are renamed when their event's date or title changes**, by the pull's
rename path (unlink the old name once the new file is certain). A file a
person or agent wrote under any name gets the standard name on the first pull
after Google accepts it. Moving a file between calendar folders is not how an
event changes calendar: the index still names the old folder, so the moved
file reads as a new event.

The flat layout (`_content/calendar/{date}_{shortId}.ics`) was converted once
by the `calendar-folders-2026-10` migration
(`src/scripts/migrate/calendar-folders/`). It writes a journal before moving
anything; the connector refuses to sync while the journal exists, and a rerun
finishes it. File contents are untouched, so recorded hashes still match and
pending edits stay pending.

Recurring events are stored as a single `.ics` with an `RRULE`; expansion to per-instance occurrences happens at query time in `loadAllEvents`, not on disk.

`.ics` is RFC 5545: editable, greppable, parses cleanly via `ical.js` with round-trip fidelity.

## Configuration

`_config/connectors/google-calendar.json` holds the calendars to sync
(default `["primary"]`) and the window:

```json
{
  "calendars": ["primary", "your.email@gmail.com", "calendar-id@group.calendar.google.com"],
  "syncDaysBack": 30,
  "syncDaysForward": 90
}
```

Find calendar IDs in Google Calendar → Settings → (calendar name) → "Integrate calendar" section.

## State

```
_bookkeeping/connectors/google-calendar-state.json   # the event index: event-file mapping (machine-owned, gitignored)
_bookkeeping/connectors/google-calendar.state.json   # transient: per-calendar sync tokens
```

The sync tokens (cursors) live in the transient file; the index file's own
`syncTokens` is always written empty. `google-calendar-state.json` tracks per-event metadata, including the filename for each Google event, relative to its calendar's folder.

**The index is keyed by (event, calendar), not by event id.** A Google event id is unique within one calendar, not across them, so a box syncing two calendars can hold two different events with the same id. Each `eventFiles` key is `<eventId> <calendarId>` — a space, with the calendar id LAST, because an event id is base32hex (plus an `_<instance stamp>` suffix for a recurring instance) and can never contain whitespace, while a calendar id is an address-like string we do not control. Build and read the key through `eventKey`/`parseEventKey` in `src/connectors/google-calendar/event-index.ts`; nothing else should join the two halves. The file carries `"version": 2` to say its keys are composite: a state file without it is re-keyed **on load**, from each entry's recorded `calendarId`, and the rewrite reaches disk on that sync's own save. The oldest entries of all — a bare filename string, from before entries carried metadata — record no calendar, so they are filed under the sentinel `(legacy)` and adopted onto the real calendar the next time a pull returns the same event id. They are kept rather than dropped for the reason in the next paragraph: an entry that disappears takes its file out of the index, and an unindexed `.ics` is pushed to Google as a new event.

**One file per entry.** Each calendar has its own folder, so the same event id on two calendars — one invitation copied into both, the ordinary case — lands in two folders. Every "is this name taken" check is scoped to one calendar. Within a folder, a pull about to write a name another entry of that calendar already holds adds a short hash of the calendar id; a disambiguated name is kept while it still describes the event. Two entries that share a file within one calendar are deduped once per sync on the way in — the entry whose recorded hash matches the file's bytes keeps it (index order decides when none or several match), the other is untracked and reported as a failure. A legacy `(legacy)` entry is adopted by the first configured calendar whose pull returns its event id; if a second calendar also holds that id, it gets its own file on its next pull.

### Failure and recovery

The state file is an *index*, not a cache: a `.ics` file missing from it is read as a locally-created event and pushed to Google. So the connector writes it atomically and, if it is ever present but unreadable, refuses to sync — `CalendarStateCorruptError`, reported as a failed sync — rather than starting from an empty index and inserting a duplicate of every local event. Recovery is a human one: inspect the file, or remove it *together with* `_content/calendar/` to start over. `bbx calendar calendars` degrades to "event count unavailable" rather than showing `0`.

Every way a sync can fall short is part of its result: a calendar whose pull failed, a rejected `x-bbx-DELETE`, a local `.ics` Google refused, a local edit whose patch was rejected. Each becomes a line in the commit's `Failed:` section and in `SyncResult.error`, so `bbx wakeup` counts it. **A push that fails leaves the local file and its recorded hash alone** — the boxholder's edit is never overwritten by Google's copy on a failed push, and the next sync retries. The mirror image is **an API call that succeeded and a local write that did not**: the tracking entry is written the moment Google accepts, before the file is touched, so a failed rewrite is one more reported failure and never an event Google holds that the box has stopped tracking (which the next run's orphan scan would insert a second time). The worst it can leave behind is a hash that no longer matches the file, which the push pass clears next run by re-sending content Google already has.

**The recorded hash is the retry queue.** A tracked `.ics` whose content no longer matches the hash the connector last wrote holds an edit Google has not accepted, and the push phase patches it — whether it was edited a minute ago or a rejected patch left it pending three syncs back. This is a separate pass from the pull, because the pull only ever sees events Google *chose to return*: an incremental sync returns nothing for an event nobody else touched, yet the sync token advances past it. Without the pass, an ordinary local edit could sit unsent until the next full resync, and a failed patch was never retried at all. Nothing is pushed or reported twice — entries the same run already reconciled (or reported as stale) are skipped — and a file carrying an `x-bbx-DELETE` marker belongs to the delete pass, which runs first and wins. An edit leaves the queue when Google accepts it — or when it is stranded (below).

**Nothing retries forever.** A push Google rejects for a transient reason (a 429, a 5xx, a network error, any other 4xx) is retried on every wakeup for seven days — `STRANDED_AFTER_MS`, the boxholder's chosen bound — measured from `pendingSince`, the stamp the first failure writes into the event's state entry and a successful push clears. A definitive rejection skips the wait entirely: a `404` or `410` on the patch, or, after a `410` resync, a non-recurring locally-edited event Google no longer returns. Either way the end is **stranding**: the `.ics` moves to its calendar folder's `stranded/`, the event is untracked, and the sync says so once — a `Stranded:` line in the commit naming the reason, and one failure in `SyncResult.error`. Nothing looks at it again (the orphan scan does not descend into the subdirectory, so it is never re-inserted into Google). To recover, move the file back out of `stranded/` into its calendar folder — untracked, it is read as a locally-created event and pushed to Google as a new one — or delete it.

After a `410` (expired sync token) the connector refetches the full window and then reconciles: a tracked, in-window event Google no longer returns was deleted remotely while the token was invalid. Its `.ics` is deleted if it still matches what the connector wrote; if it was edited locally the file is stranded, because the edit can never be pushed to an event that no longer exists (leaving it tracked meant re-reporting the same stuck file forever; untracking it in place would make the next push pass insert the just-deleted event back into Google, which is exactly what moving it into `stranded/` prevents). Events outside the refetched window are never touched, and neither are **recurring masters**: with `singleEvents=false` and a `timeMin`/`timeMax`, whether a series' master comes back in a window is Google's judgement about where its instances fall, so an absent master is no evidence of deletion. A series really deleted in Google arrives as a cancelled event on an ordinary pull.

## Verify

```bash
# Pull calendar events
bbx wakeup --connector google-calendar

# View today's events
bbx calendar today

# View upcoming events (default: next 7 days)
bbx calendar
```

## CLI

| Command | What it does |
|---|---|
| `bbx calendar [timespan]` | Show events in a window. `timespan` is `today`, `Nd` (days), `Nw` (weeks), or `Nm` (months of 30 days); the default is `7d`. There is no minutes unit. |
| `bbx calendar calendars` | List available Google calendars; mark which are syncing; show event count from state. |
| `bbx calendar add <id>` | Add a calendar to the sync set. |
| `bbx calendar remove <id>` | Remove a calendar from the sync set. |

Sync itself runs through the normal connector path (`bbx wakeup --connector google-calendar` or as part of a full `bbx wakeup`).

## Connector shape

```typescript
class GoogleCalendarConnector implements Connector {
  name = "google-calendar";

  // Pull:
  //   1. Load OAuth credentials
  //   2. Fetch events via Google Calendar API
  //   3. Write/update .ics files in each calendar card's folder
  //   4. Remove .ics files for deleted events
  //   5. Update sync cursor + event-file mapping in state
  //   6. Stage + commit changes
}
```

Local edits and locally-created `.ics` files are pushed back to Google during sync, so the connector is bidirectional — pull is the primary path; the push path is implemented and doctest-covered, but has little real-world mileage.

## Auth

Google Calendar requires OAuth2. Tokens come from the shared
[Google auth](google-auth.md#where-tokens-live) grant and refresh on demand
from within the connector.

## Design choices worth noting

- **No realized monthly card views.** Cards are for things that need workflow processing (questions, jobs, intake). Calendar views are read-time queries.
- **Title-based filenames over UID-based.** The standard CalDAV tools (vdirsyncer etc.) use the iCal UID as the filename — opaque, not greppable. We name files by date and title and track the event↔filename mapping in state, as [caldir](https://caldir.org/) does. Worth the extra bookkeeping for listings, diffs, and paths in chat.
- **Events stay `.ics`, under one card per calendar.** The format is what any calendar source (CalDAV, an `.ics` subscription) can fill; the card is the calendar's place in the box.
- **RRULE for recurrence.** Recurring events are one file, expanded at query time. Avoids file proliferation; agents see a single canonical event.
- **`.ics` as a possible substrate for scheduled tasks too.** RRULE expresses recurring schedules in a standard way; could be reused for cron-like tasks (`FREQ=DAILY;BYHOUR=9`). Not currently used for that — flagged as a reuse possibility.

## Known limitations

- **Push path is lightly exercised.** Local `.ics` edits and locally-created events are detected (content hash) and pushed back to Google. The failure and retry behavior is covered by tests against the fake service, but the path has little real-world mileage and scheduled auto-sync is disabled by default.
- **Conflicts resolve remote-wins.** When an event changed both locally and in Google since the last pull, Google's version overwrites the local file and the edit is discarded (recorded as such in the commit). A *failed* push is not a conflict and never discards the edit.
- **Recurring event edits.** Editing a single occurrence of a recurring series in Google Calendar (creating an `EXDATE` or override) is fetched, but the local representation is whatever Google returns in the series — no separate per-occurrence file.

## Libraries

- **ical.js** — full iCal parsing/serialization, used throughout.
- **googleapis** — OAuth + Google Calendar API client.

Considered but not chosen:
- **@jalexw/calendar-ics-parser** — Zod schemas, read-only. No serialization or RRULE expansion.
- **vdirsyncer / khal** — Python tools with bidirectional CalDAV sync, but UID-based filenames only.
