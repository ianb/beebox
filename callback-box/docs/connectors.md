# Connectors

Connectors bridge external services to the box filesystem. Each implements the `Connector` interface with a `sync()` method that pulls data in (and sometimes pushes data out).

## How connectors work

```
External service → Connector.sync() → Writes/reads card files → Git commit
```

A connector's `sync()` method:
1. Reads config from `config/connectors/<name>.secret.json`
2. Pulls new data from the external service
3. Creates/updates card files in the box
4. Stages and commits changes with structured trailers
5. Optionally pushes local changes back to the service (two-way sync)
6. Creates job cards for downstream processing (e.g., chat jobs for new messages)

Returns a `SyncResult` with `{ success, created, updated, pushed?, jobs?, error? }`.

## Connector inventory

| Connector | File | Card types | Direction | Service-injected |
|-----------|------|-----------|-----------|-----------------|
| Telegram | `telegram.ts` | `chat-thread` | Two-way | Yes |
| RSS | `rss.ts` | `news-item` | Pull only | No (HTTP stubs) |
| Google Calendar | `google-calendar.ts` | `.ics` files | Two-way | Not yet wired |
| Gmail | `gmail.ts` | `email-thread` | Pull only | Not yet wired |

## Lifecycle

Connectors are called during `cb wakeup`:
1. `wakeup.ts` loads connector configs for the box
2. Creates connector instances (with optional service injection)
3. Calls `sync()` on each
4. Reports results

Telegram also has a webhook route (`routes/telegram.ts`) for real-time message delivery, separate from the polling in `sync()`.

## Configuration

Each connector reads its config from `config/connectors/`:
- `telegram.secret.json` — `{ botToken, webhookSecret }`
- `google-calendar.json` — `{ calendars, syncDaysBack, syncDaysForward }`
- `gmail.secret.json` — IMAP credentials

Transient state (last sync offsets, mappings) goes in `config/connectors/<name>.state.json` or `<name>-state.json`.

## Service injection

Connectors that call external APIs accept an optional service parameter:

```typescript
export function createTelegramConnector(boxRoot: string, telegram?: TelegramService): Connector
```

When no service is provided, connectors create real implementations from config files. When a fake is injected (in tests), all API calls go through the fake.

Inside the connector, a helper pattern provides the fallback:

```typescript
private getTelegram(botToken: string): TelegramService {
  return this.telegramService ?? createTelegramService(botToken);
}
```

See `src/services/CLAUDE.md` for the full service layer documentation.

## Writing a new connector

1. Implement the `Connector` interface (`name`, `produces`, `sync()`)
2. Read config from `config/connectors/<name>.secret.json`
3. Use transient state for sync cursors/offsets
4. Stage and commit all file changes with descriptive messages and trailers
5. Create job cards when new items need processing
6. Register via `registerConnector()` in the connector registry
7. Add a service interface if the connector calls external APIs (see `src/services/CLAUDE.md`)

## Shared utilities

- `chat-utils.ts` — Thread file management: `ensureThreadFile()`, `appendMessageToThread()`, `findUnsentAgentMessages()`, `stampSentMessage()`, `safeFilename()`, `updatePersonEntry()`
- `calendar-utils.ts` — ICS parsing, event formatting, timespan parsing
- `intake-utils.ts` — `createOrAppendIntakeJob()` for creating inbox triage jobs
- `transient-state.ts` — `loadTransientState()` / `saveTransientState()` for non-committed state
- `calendar-config.ts` — Calendar sync configuration management
