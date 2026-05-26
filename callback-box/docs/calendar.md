# Calendar Integration

**Status: Implemented (pull-only).** Google Calendar → `.ics` files in `store/calendar/`. Local-edits-pushed-back is not implemented; that's the major piece of the original "bidirectional" goal still outstanding.

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

## CLI

| Command | What it does |
|---|---|
| `cb calendar [timespan]` | Show events in a window. `timespan` is `today`, `Nd`, `Nw`, `Nm` (default `7d`). |
| `cb calendar calendars` | List available Google calendars; mark which are syncing; show event count from state. |
| `cb calendar add <id>` | Add a calendar to the sync set. |
| `cb calendar remove <id>` | Remove a calendar from the sync set. |

Sync itself runs through the normal connector path (`cb connector sync google-calendar` or as part of `cb wakeup`).

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

`produces` is `["calendar-event"]`; there is no `handles` array, since local edits aren't currently pushed back. The connector is one-way.

## Auth

Google Calendar requires OAuth2 (unlike Gmail, which accepts app passwords). Auth setup goes through `cb google-auth`; tokens land in `google-calendar.secret.json` and refresh on demand from within the connector.

## Design choices worth noting

- **No realized monthly card views.** Cards are for things that need workflow processing (questions, jobs, intake). Calendar views are read-time queries.
- **Slug-based filenames over UID-based.** The standard CalDAV tools (vdirsyncer etc.) use the iCal UID as the filename — opaque, not greppable. We prefer slugs and track the UID↔filename mapping in state. Worth the extra bookkeeping for the agent's grep-ability.
- **RRULE for recurrence.** Recurring events are one file, expanded at query time. Avoids file proliferation; agents see a single canonical event.
- **`.ics` as a possible substrate for scheduled tasks too.** RRULE expresses recurring schedules in a standard way; could be reused for cron-like tasks (`FREQ=DAILY;BYHOUR=9`). Not currently used for that — flagged as a reuse possibility.

## Known limitations

- **One-way only.** Local `.ics` edits are not detected or pushed back to Google. Bidirectional sync was in the original design but not built; the slug-vs-UID filename choice was made partly with bidirectional in mind, but the change-detection layer doesn't exist yet.
- **Slug collisions.** Two events with the same slug currently get a numeric suffix; revisit if it becomes noisy.
- **Recurring event edits.** Editing a single occurrence of a recurring series in Google Calendar (creating an `EXDATE` or override) is fetched, but the local representation is whatever Google returns in the series — no separate per-occurrence file.

## Libraries

- **ical.js** — full iCal parsing/serialization, used throughout.
- **googleapis** — OAuth + Google Calendar API client.

Considered but not chosen:
- **@jalexw/calendar-ics-parser** — Zod schemas, read-only. No serialization or RRULE expansion.
- **vdirsyncer / khal** — Python tools with bidirectional CalDAV sync, but UID-based filenames only.
