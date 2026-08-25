# Calendar Integration

**Status: Implemented (bidirectional).** Google Calendar ↔ `.ics` files in `store/calendar/`. Pull is the well-exercised path; local edits, locally-created events, and `X-CB-DELETE` markers are pushed back to Google during sync. Caveats: scheduled auto-sync is disabled by default, and the push path has little real-world mileage.

## Overview

Google Calendar sync into `.ics` files as the canonical local store. Events are pulled on each calendar connector sync; the CLI surfaces them via `cb calendar`. No realized monthly card views — queries are CLI-driven.

## Storage

Events live as individual `.ics` files in `store/calendar/`, one per event, with human-readable slugged filenames:

```
store/calendar/
  Weekly_team_standup.ics
  Dentist_Feb_20.ics
  ...
```

Recurring events are stored as a single `.ics` with an `RRULE`; expansion to per-instance occurrences happens at query time in `loadAllEvents`, not on disk.

`.ics` is RFC 5545: editable, greppable, parses cleanly via `ical.js` with round-trip fidelity.

## Config and state

```
config/connectors/google-calendar.json         # sync settings (which calendars)
config/connectors/google-calendar.secret.json  # OAuth tokens (gitignored)
config/connectors/google-calendar-state.json   # sync cursor, event-file mapping
```

`google-calendar.json` holds the list of calendar IDs to sync (default: `["primary"]`). `google-calendar-state.json` tracks per-event metadata, including the slugged filename for each Google event ID (so re-syncs update the right file even if the slug would change).

### Failure and recovery

The state file is an *index*, not a cache: a `.ics` file missing from it is read as a locally-created event and pushed to Google. So the connector writes it atomically and, if it is ever present but unreadable, refuses to sync — `CalendarStateCorruptError`, reported as a failed sync — rather than starting from an empty index and inserting a duplicate of every local event. Recovery is a human one: inspect the file, or remove it *together with* `store/calendar/` to start over. `cb calendar calendars` degrades to "event count unavailable" rather than showing `0`.

Every way a sync can fall short is part of its result: a calendar whose pull failed, a rejected `X-CB-DELETE`, a local `.ics` Google refused, a local edit whose patch was rejected. Each becomes a line in the commit's `Failed:` section and in `SyncResult.error`, so `cb wakeup` counts it. **A push that fails leaves the local file and its recorded hash alone** — the boxholder's edit is never overwritten by Google's copy on a failed push, and the next sync retries. The mirror image is **an API call that succeeded and a local write that did not**: the tracking entry is written the moment Google accepts, before the file is touched, so a failed rewrite is one more reported failure and never an event Google holds that the box has stopped tracking (which the next run's orphan scan would insert a second time). The worst it can leave behind is a hash that no longer matches the file, which the push pass clears next run by re-sending content Google already has.

**The recorded hash is the retry queue.** A tracked `.ics` whose content no longer matches the hash the connector last wrote holds an edit Google has not accepted, and the push phase patches it — whether it was edited a minute ago or a rejected patch left it pending three syncs back. This is a separate pass from the pull, because the pull only ever sees events Google *chose to return*: an incremental sync returns nothing for an event nobody else touched, yet the sync token advances past it. Without the pass, an ordinary local edit could sit unsent until the next full resync, and a failed patch was never retried at all. Nothing is pushed or reported twice — entries the same run already reconciled (or reported as stale) are skipped — and a file carrying an `X-CB-DELETE` marker belongs to the delete pass, which runs first and wins.

After a `410` (expired sync token) the connector refetches the full window and then reconciles: a tracked, in-window event Google no longer returns was deleted remotely while the token was invalid. Its `.ics` is deleted if it still matches what the connector wrote; if it was edited locally, the file is kept and still tracked, and the sync reports a `stale-cleanup` failure — untracking it would make the next push pass insert the just-deleted event back into Google. On later runs that stranded file keeps failing its retried patch, so it stays visible instead of being mentioned once and forgotten. Events outside the refetched window are never touched, and neither are **recurring masters**: with `singleEvents=false` and a `timeMin`/`timeMax`, whether a series' master comes back in a window is Google's judgement about where its instances fall, so an absent master is no evidence of deletion. A series really deleted in Google arrives as a cancelled event on an ordinary pull.

## CLI

| Command | What it does |
|---|---|
| `cb calendar [timespan]` | Show events in a window. `timespan` is `today`, `Nd`, `Nw`, `Nm` (default `7d`). |
| `cb calendar calendars` | List available Google calendars; mark which are syncing; show event count from state. |
| `cb calendar add <id>` | Add a calendar to the sync set. |
| `cb calendar remove <id>` | Remove a calendar from the sync set. |

Sync itself runs through the normal connector path (`cb wakeup --connector google-calendar` or as part of a full `cb wakeup`).

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

Google Calendar requires OAuth2 (unlike Gmail, which accepts app passwords). Auth setup goes through `cb google-auth`; tokens land in `google-calendar.secret.json` and refresh on demand from within the connector.

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
