# Connectors

Connectors bridge external services to the box filesystem. Each implements the `Connector` interface with a `sync()` method that pulls data in (and sometimes pushes data out).

## How connectors work

```
External service → Connector.sync() → Writes/reads card files → Git commit
```

A connector's `sync()` method:
1. Reads its config from `_config/connectors/<name>.json` and its credentials
   from the machine-level secret store ([`docs/secrets.md`](secrets.md)). Some
   box-authored integrations (capture, dropbox, raindrop, kie, omdb, tmdb) still
   keep their own `_config/connectors/<name>.secret.json`; no built-in connector
   does
2. Pulls new data from the external service
3. Creates/updates card files in the box
4. Stages and commits changes with structured trailers
5. Optionally pushes local changes back to the service (two-way sync)
6. Creates job cards for downstream processing (e.g., chat jobs for new messages)

Returns a `SyncResult` with `{ success, created, updated, pushed?, jobs?, procedures?, error? }`.
Procedure requests are run by wakeup orchestration after connector writes finish.

Sync rebuilds a connector-managed card's content wholesale from its template; any agent-added field the template doesn't know about is lost unless it's one of the few fields `preserve-agent-fields.ts` explicitly carries forward (currently just `contains`).

## Connector inventory

| Connector | File | Card types | Direction | Service-injected | Setup doc |
|-----------|------|-----------|-----------|-----------------|-----------|
| Telegram | `telegram.ts` | `chat-thread` | Two-way | Yes | [telegram-setup.md](telegram-setup.md) |
| Google Calendar | `google-calendar.ts` | `.ics` files | Two-way | Yes | [calendar.md](calendar.md) |
| Gmail | `gmail.ts` | `email-thread`, `email-message`, `email-outbound` | Two-way (pull + draft upload) | Yes | [gmail-setup.md](gmail-setup.md) |
| Google Drive | `google-drive.ts` | `sheet` | Two-way | Yes | [google-drive.md](google-drive.md) |

## Lifecycle

Connectors are called during `bbx wakeup`:
1. `wakeup.ts` loads connector configs for the box
2. Creates connector instances (with optional service injection)
3. Calls `sync()` on each
4. Reports results

Telegram also has a webhook route (`routes/telegram.ts`) for real-time message delivery, separate from the polling in `sync()`.

## Configuration

Each connector reads its non-credential config from `_config/connectors/`:
- `google-calendar.json` — `{ calendars, syncDaysBack, syncDaysForward }`
- `gmail.json` — named Gmail query rules with a bounded `track` action, a
  `procedure` action, or a `stage` action (record a pending summary and do
  nothing else), or the equivalent `query`/`labels` shorthand for a single rule.
  Every shape states its action explicitly; a missing action, or a missing file,
  is an error that stops the sync rather than a silent no-op. The history
  cursor, budgets, and bounded pending summaries live in gitignored
  `_bookkeeping/connectors/gmail.state.json`.
  A live email-thread card is the sole tracking registry; deleting it untracks
  the thread without changing Gmail. See [gmail-setup.md](gmail-setup.md).

Telegram's credentials (`{ botToken, webhookSecret }`) are the store's
`telegram-bot/<box>` secret, resolved by `connectors/telegram-helpers.ts` —
see [`docs/secrets.md`](secrets.md).

Transient state (last sync offsets, mappings) goes in `_bookkeeping/connectors/<name>.state.json` or `<name>-state.json`.

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
2. Declare and resolve credentials via the machine secret store
   ([`docs/secrets.md`](secrets.md)) rather than a new `<name>.secret.json`
   file
3. Use transient state for sync cursors/offsets
4. Stage and commit all file changes with descriptive messages and trailers
5. Create job cards when new items need processing
6. Register via `registerConnector()` in the connector registry
7. Add a service interface if the connector calls external APIs (see `src/services/CLAUDE.md`)

## Shared utilities

- `chat-utils.ts` — Thread file management: `ensureThreadFile()`, `appendMessageToThread()`, `findUnsentAgentMessages()`, `stampSentMessage()`, `safeFilename()`, `updatePersonEntry()`
- `calendar-utils.ts` — ICS parsing, event formatting, timespan parsing
- `intake-utils.ts` — `createOrAppendIntakeJob()` for creating reactor inbox-processing jobs (legacy reactor path, distinct from the new intake → triage → handle pipeline in `docs/triage.md`)
- `transient-state.ts` — `loadTransientState()` / `saveTransientState()` for non-committed state
- `calendar-config.ts` — Calendar sync configuration management
