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
- **google-calendar.ts** — uses `GoogleCalendarService`. ICS parsing via `ical.js` stays in the connector — pure transformation, not an external dependency. `fetchAvailableCalendars` in `calendar-config.ts` also takes a `GoogleCalendarService`; build one from auth with `createGoogleCalendarService(createGoogleAuthService(auth))` when calling from a CLI or route without an injected service.
