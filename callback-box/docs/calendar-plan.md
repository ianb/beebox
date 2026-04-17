# Calendar Integration Plan

## Overview
Bidirectional Google Calendar sync using .ics files as the canonical store.

## Key Design Decisions

### Storage: .ics files with slugged names
- Events stored as individual .ics files in `store/calendar/`
- Human-readable slugged filenames: `Weekly_team_standup.ics`, `Dentist_appointment.ics`
- .ics is RFC 5545, reasonably editable/greppable
- Validated with `ical.js` — round-trips cleanly

### No realized monthly views
- User prefers CLI queries over static monthly `.card` files
- Build CLI commands to query calendar data (upcoming events, date ranges, etc.)
- Cards are for things that need workflow processing, not static views

### Auth: OAuth2 (required for Google Calendar)
- Unlike Gmail (app passwords), Google Calendar API requires OAuth2
- REST API or CalDAV are both options
- vdirsyncer does bidirectional CalDAV sync but uses UID-based filenames (not configurable)

### Cron jobs via RRULE
- .ics RRULE can represent recurring schedules
- Potential to use .ics files for cron/scheduled tasks too
- RRULE examples: `FREQ=DAILY;BYHOUR=9`, `FREQ=WEEKLY;BYDAY=MO,WE,FR`

## Directory Layout
```
store/calendar/
  Weekly_team_standup.ics
  Dentist_Feb_20.ics
  ...
config/connectors/google-calendar.secret.json  # OAuth tokens
config/connectors/google-calendar.json          # sync settings (which calendars, etc.)
config/connectors/google-calendar-state.json    # sync cursor/tokens
```

## Libraries Considered
- **ical.js** — full iCal parsing/serialization, proven round-trip
- **@jalexw/calendar-ics-parser** — Zod schemas for iCal (read-only, no RRULE expansion, no serialization)
- **vdirsyncer** (Python) — bidirectional CalDAV sync, but UID filenames only
- **khal** — terminal calendar viewer, has JSON output but can't show source filenames

## CLI Commands (planned)
- `cb calendar upcoming` — show next N events
- `cb calendar range --from DATE --to DATE` — events in date range
- `cb calendar today` / `cb calendar week`
- Query by calendar, search text, etc.

## Connector Shape
```
class GoogleCalendarConnector implements Connector
  name = "google-calendar"
  handles = ["calendar-event"]  # future: create/update events
  produces = []                 # .ics files, not cards

  pull():
    1. Load OAuth credentials
    2. Fetch events via Google Calendar API (or CalDAV)
    3. Write/update .ics files with slugged names
    4. Remove .ics files for deleted events
    5. Update sync cursor in state file
    6. Stage + commit changes
```

## Open Questions
- OAuth2 flow: how to handle token refresh in CLI context?
- Slug collisions: append short ID suffix if needed?
- Which calendars to sync (all vs configured subset)?
- How to handle recurring events: one .ics per series or per instance?
- Bidirectional: how to detect local .ics edits to push back?
