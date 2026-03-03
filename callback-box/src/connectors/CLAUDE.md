# Connectors

Connectors sync external services with the box filesystem. Each implements the `Connector` interface with a `sync()` method that pulls data in (and sometimes pushes data out).

## Service injection

Connectors that call external APIs accept an optional service parameter in their factory function:

```typescript
export function createTelegramConnector(boxRoot: string, telegram?: TelegramService): Connector
export function createRaindropConnector(boxRoot: string, raindrop?: RaindropService): Connector
```

When no service is provided, connectors create real implementations from config files at sync time. When a fake service is injected (in tests), all API calls go through the fake instead.

See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patterns.

## Currently service-injected

- **telegram.ts** — uses `TelegramService` (getUpdates, sendMessage, setWebhook, deleteWebhook)
- **raindrop.ts** — uses `RaindropService` (listCollections, listBookmarks, createBookmark, updateBookmark)

## Not yet service-injected

These connectors use library-specific types that don't cleanly map to our service abstractions:

- **dropbox.ts** — uses `callback-dropbox/client` with `DecryptedMessage`, Zod schemas for message validation
- **capture.ts** — uses `callback-dropbox/client` `CaptureClient` with `downloadFile` (not in service interface)
- **gmail.ts** — uses `imapflow` with library-specific message types and `mailparser` for MIME parsing
- **google-calendar.ts** — uses `getGoogleAuth()` + direct REST calls with ICS parsing via `ical.js`

Service definitions exist for all of these in `src/services/` (imap.ts, dropbox-relay.ts, capture-relay.ts, google-calendar.ts) but the connector wiring hasn't been done yet because the type gaps are larger.
