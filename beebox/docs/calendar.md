# Calendar Integration

**Status: Implemented (bidirectional).** Google Calendar ↔ `.ics` files in `_content/calendar/`. Pull is the well-exercised path; local edits, locally-created events, and `x-bbx-DELETE` markers are pushed back to Google during sync. Caveats: scheduled auto-sync is disabled by default, and the push path has little real-world mileage.

## Overview

Google Calendar sync into `.ics` files as the canonical local store. Events are pulled on each calendar connector sync; the CLI surfaces them via `bbx calendar`. No realized monthly card views — queries are CLI-driven.

## Storage

Events live as individual `.ics` files in `_content/calendar/`, one per event, with human-readable slugged filenames:

```
_content/calendar/
  Weekly_team_standup.ics
  Dentist_Feb_20.ics
  ...
```

Recurring events are stored as a single `.ics` with an `RRULE`; expansion to per-instance occurrences happens at query time in `loadAllEvents`, not on disk.

`.ics` is RFC 5545: editable, greppable, parses cleanly via `ical.js` with round-trip fidelity.

## Config and state

```
_config/connectors/google-calendar.json         # sync settings (which calendars)
_config/connectors/google-calendar.secret.json  # OAuth tokens (gitignored)
_config/connectors/google-calendar-state.json   # sync cursor, event-file mapping
```

`google-calendar.json` holds the list of calendar IDs to sync (default: `["primary"]`). `google-calendar-state.json` tracks per-event metadata, including the slugged filename for each Google event ID (so re-syncs update the right file even if the slug would change).

**The index is keyed by (event, calendar), not by event id.** A Google event id is unique within one calendar, not across them, so a box syncing two calendars can hold two different events with the same id. Each `eventFiles` key is `<eventId> <calendarId>` — a space, with the calendar id LAST, because an event id is base32hex (plus an `_<instance stamp>` suffix for a recurring instance) and can never contain whitespace, while a calendar id is an address-like string we do not control. Build and read the key through `eventKey`/`parseEventKey` in `src/connectors/google-calendar-event-index.ts`; nothing else should join the two halves. The file carries `"version": 2` to say its keys are composite: a state file without it is re-keyed **on load**, from each entry's recorded `calendarId`, and the rewrite reaches disk on that sync's own save. The oldest entries of all — a bare filename string, from before entries carried metadata — record no calendar, so they are filed under the sentinel `(legacy)` and adopted onto the real calendar the next time a pull returns the same event id. They are kept rather than dropped for the reason in the next paragraph: an entry that disappears takes its file out of the index, and an unindexed `.ics` is pushed to Google as a new event.

**One file per entry.** The `.ics` name (`{YYYY-MM-DD}_{shortId}.ics`) carries no calendar either, so the same event id on two calendars on the same date — one invitation copied into both, the ordinary case — would name one file for two events, and a rewrite from one calendar's pull would leave the other entry's recorded hash mismatched, so the pending-edit pass would patch the wrong calendar's event. When a pull is about to write a file whose natural name another entry already holds, the name gains a short hash of the calendar id (`2026-06-10_t-shared_4ea140.ics`). A disambiguated name is kept as long as it still describes the event, so files are not renamed back and forth as the colliding partner comes and goes, and **no existing file is ever renamed** — nothing is owed a rename migration. The push pass needs none of this: a file it pushes is by definition one no entry names. Two entries that already share a file (a box that synced before the key change) are deduped once per sync on the way in — the entry whose recorded hash matches the file's bytes keeps it (index order decides when none or several match), the other is untracked and reported as a failure. A legacy `(legacy)` entry is adopted by the first configured calendar whose pull returns its event id; if a second calendar also holds that id, it gets its own file on its next pull.

### Failure and recovery

The state file is an *index*, not a cache: a `.ics` file missing from it is read as a locally-created event and pushed to Google. So the connector writes it atomically and, if it is ever present but unreadable, refuses to sync — `CalendarStateCorruptError`, reported as a failed sync — rather than starting from an empty index and inserting a duplicate of every local event. Recovery is a human one: inspect the file, or remove it *together with* `_content/calendar/` to start over. `bbx calendar calendars` degrades to "event count unavailable" rather than showing `0`.

Every way a sync can fall short is part of its result: a calendar whose pull failed, a rejected `x-bbx-DELETE`, a local `.ics` Google refused, a local edit whose patch was rejected. Each becomes a line in the commit's `Failed:` section and in `SyncResult.error`, so `bbx wakeup` counts it. **A push that fails leaves the local file and its recorded hash alone** — the boxholder's edit is never overwritten by Google's copy on a failed push, and the next sync retries. The mirror image is **an API call that succeeded and a local write that did not**: the tracking entry is written the moment Google accepts, before the file is touched, so a failed rewrite is one more reported failure and never an event Google holds that the box has stopped tracking (which the next run's orphan scan would insert a second time). The worst it can leave behind is a hash that no longer matches the file, which the push pass clears next run by re-sending content Google already has.

**The recorded hash is the retry queue.** A tracked `.ics` whose content no longer matches the hash the connector last wrote holds an edit Google has not accepted, and the push phase patches it — whether it was edited a minute ago or a rejected patch left it pending three syncs back. This is a separate pass from the pull, because the pull only ever sees events Google *chose to return*: an incremental sync returns nothing for an event nobody else touched, yet the sync token advances past it. Without the pass, an ordinary local edit could sit unsent until the next full resync, and a failed patch was never retried at all. Nothing is pushed or reported twice — entries the same run already reconciled (or reported as stale) are skipped — and a file carrying an `x-bbx-DELETE` marker belongs to the delete pass, which runs first and wins. An edit leaves the queue when Google accepts it — or when it is stranded (below).

**Nothing retries forever.** A push Google rejects for a transient reason (a 429, a 5xx, a network error, any other 4xx) is retried on every wakeup for seven days — `STRANDED_AFTER_MS`, the boxholder's chosen bound — measured from `pendingSince`, the stamp the first failure writes into the event's state entry and a successful push clears. A definitive rejection skips the wait entirely: a `404` or `410` on the patch, or, after a `410` resync, a non-recurring locally-edited event Google no longer returns. Either way the end is **stranding**: the `.ics` moves to `_content/calendar/stranded/`, the event is untracked, and the sync says so once — a `Stranded:` line in the commit naming the reason, and one failure in `SyncResult.error`. Nothing looks at it again (the orphan scan does not descend into the subdirectory, so it is never re-inserted into Google). To recover, move the file back out of `stranded/` into `_content/calendar/` — untracked, it is read as a locally-created event and pushed to Google as a new one — or delete it.

After a `410` (expired sync token) the connector refetches the full window and then reconciles: a tracked, in-window event Google no longer returns was deleted remotely while the token was invalid. Its `.ics` is deleted if it still matches what the connector wrote; if it was edited locally the file is stranded, because the edit can never be pushed to an event that no longer exists (leaving it tracked meant re-reporting the same stuck file forever; untracking it in place would make the next push pass insert the just-deleted event back into Google, which is exactly what moving it out of `_content/calendar/` prevents). Events outside the refetched window are never touched, and neither are **recurring masters**: with `singleEvents=false` and a `timeMin`/`timeMax`, whether a series' master comes back in a window is Google's judgement about where its instances fall, so an absent master is no evidence of deletion. A series really deleted in Google arrives as a cancelled event on an ordinary pull.

## CLI

| Command | What it does |
|---|---|
| `bbx calendar [timespan]` | Show events in a window. `timespan` is `today`, `Nd`, `Nw`, `Nm` (default `7d`). |
| `bbx calendar calendars` | List available Google calendars; mark which are syncing; show event count from state. |
| `bbx calendar add <id>` | Add a calendar to the sync set. |
| `bbx calendar remove <id>` | Remove a calendar from the sync set. |

Sync itself runs through the normal connector path (`bbx wakeup --connector google-calendar` or as part of a full `bbx wakeup`).

## Connector shape

```typescript
class GoogleCalendarConnector implements Connector {
  name = "google-calendar";
  produces = ["calendar-event"];  // .ics files (not cards)

  // Pull:
  //   1. Load OAuth credentials
  //   2. Fetch events via Google Calendar API
  //   3. Write/update .ics files with slugged names
  //   4. Remove .ics files for deleted events
  //   5. Update sync cursor + event-file mapping in state
  //   6. Stage + commit changes
}
```

`produces` is `["calendar-event"]`. Local edits and locally-created `.ics` files are pushed back to Google during sync, so the connector is bidirectional — pull is the primary path; the push path is implemented and doctest-covered, but has little real-world mileage.

## Auth

Google Calendar requires OAuth2 (unlike Gmail, which accepts app passwords). Auth setup goes through `bbx google-auth`; tokens land in `google-calendar.secret.json` and refresh on demand from within the connector.

## Design choices worth noting

- **No realized monthly card views.** Cards are for things that need workflow processing (questions, jobs, intake). Calendar views are read-time queries.
- **Slug-based filenames over UID-based.** The standard CalDAV tools (vdirsyncer etc.) use the iCal UID as the filename — opaque, not greppable. We prefer slugs and track the UID↔filename mapping in state. Worth the extra bookkeeping for the agent's grep-ability.
- **RRULE for recurrence.** Recurring events are one file, expanded at query time. Avoids file proliferation; agents see a single canonical event.
- **`.ics` as a possible substrate for scheduled tasks too.** RRULE expresses recurring schedules in a standard way; could be reused for cron-like tasks (`FREQ=DAILY;BYHOUR=9`). Not currently used for that — flagged as a reuse possibility.

## Known limitations

- **Push path is lightly exercised.** Local `.ics` edits and locally-created events are detected (content hash) and pushed back to Google. The failure and retry behavior is covered by doctests against the fake service, but the path has little real-world mileage and scheduled auto-sync is disabled by default.
- **Conflicts resolve remote-wins.** When an event changed both locally and in Google since the last pull, Google's version overwrites the local file and the edit is discarded (recorded as such in the commit). A *failed* push is not a conflict and never discards the edit.
- **Slug collisions.** Two events with the same slug currently get a numeric suffix; revisit if it becomes noisy.
- **Recurring event edits.** Editing a single occurrence of a recurring series in Google Calendar (creating an `EXDATE` or override) is fetched, but the local representation is whatever Google returns in the series — no separate per-occurrence file.

## Libraries

- **ical.js** — full iCal parsing/serialization, used throughout.
- **googleapis** — OAuth + Google Calendar API client.

Considered but not chosen:
- **@jalexw/calendar-ics-parser** — Zod schemas, read-only. No serialization or RRULE expansion.
- **vdirsyncer / khal** — Python tools with bidirectional CalDAV sync, but UID-based filenames only.
