# Connectors

Connectors sync external services with the box filesystem. Each implements the `Connector` interface with a `sync()` method that pulls data in (and sometimes pushes data out).

## Service injection

Connectors that call external APIs accept an optional service parameter in their factory function:

```typescript
export function createTelegramConnector(boxRoot: string, telegram?: TelegramService): Connector
```

When no service is provided, connectors create real implementations from config files at sync time. When a fake service is injected (in tests), all API calls go through the fake instead.

See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patterns.

## Currently service-injected

- **telegram.ts** — uses `TelegramService`
- **gmail.ts** — uses `GoogleGmailService` (Gmail REST API via shared Google OAuth)
- **google-drive.ts** — uses `GoogleDriveService`

## Not yet service-injected

- **google-calendar.ts** — uses `getGoogleAuth()` + direct `ky` REST calls. A `GoogleCalendarService` interface exists but the connector hasn't been wired through it yet. ICS parsing via `ical.js` stays in the connector — that's pure transformation, not an external dependency.

  **Migration checklist:**
  1. **Add `patchEvent` to `GoogleCalendarService`** (in `src/services/google-calendar.ts`) — the connector does PATCH for event updates and the service surface doesn't cover it yet. Real impl wraps the `PATCH /calendars/{id}/events/{id}` endpoint; fake mutates its in-memory event store.
  2. **Change the connector factory signature** to accept the optional service:
     ```typescript
     export function createGoogleCalendarConnector(
       boxRoot: string,
       calendar?: GoogleCalendarService,
     ): Connector
     ```
     Add a `getCalendar()` helper that returns the injected service or builds a real one from `getGoogleAuth(boxRoot)` + `createGoogleCalendarService(auth)`.
  3. **Replace direct API calls** (5 sites) with service method calls:
     - `google-calendar.ts:~1279` — `ky.delete(.../events/{id})` → `calendar.deleteEvent(calendarId, eventId)`
     - `google-calendar.ts:~1312` — `ky.post(.../events)` → `calendar.insertEvent(calendarId, event)`
     - `google-calendar.ts:~1345` — `ky.patch(.../events/{id})` → `calendar.patchEvent(...)` (after step 1)
     - `google-calendar.ts:~1397` — `ky.get(.../events)` → `calendar.listEvents(calendarId, opts)`
     - `calendar-config.ts:~84` (`fetchAvailableCalendars`) — `ky.get(.../calendarList)` → `calendar.listCalendars()`. Either change the helper's signature to accept a `GoogleCalendarService`, or inline-call the service from the connector and delete the helper.
  4. **Add the `calendar` field** to the `Services` container in `src/services/index.ts` (already there) and make sure `server.ts` passes it through anywhere a calendar connector is constructed.
  5. **Backfill a doctest** for the connector that uses `createFakeGoogleCalendar({ calendars, events })` and asserts on the fake's observable state — this is the payoff for doing the migration.
