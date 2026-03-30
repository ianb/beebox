# Services

Every external dependency (API, library, CLI tool) is wrapped in a **typed service interface** with three parts:

1. **Interface** — the subset of the external API we actually use
2. **Real implementation** — thin wrapper around the library/API, created from config (token, credentials)
3. **Fake implementation** — domain-specific in-memory implementation for tests

## Pattern

```typescript
// Interface — only the methods we call
export interface FooService {
  doThing(id: string): Promise<Result>;
}

// Real — wraps the library
export function createFooService(token: string): FooService { ... }

// Fake — domain-specific constructor with observable state
export function createFakeFoo(opts?: { items?: Item[] }): FakeFooService { ... }

// Fake extends the interface with inspectable state
export interface FakeFooService extends FooService {
  items: Item[];        // mutable arrays for inspection
  sent: Message[];      // outbox-style tracking
}
```

## Design rules

- **Fakes are domain-specific**, not generic `Partial<T>` overrides. Constructor params reflect what the service needs to function (e.g., `createFakeTelegram({ username: "bot" })` requires a username because `getMe()` returns it).
- **Fakes have observable state** — outbox arrays (`.sent`), mutable collections (`.bookmarks`), status flags (`.connected`). Tests inspect these directly.
- **Optional `| undefined`** — all service fields in the `Services` container and in route option interfaces must use `?: T | undefined` (not just `?: T`) because of `exactOptionalPropertyTypes` in tsconfig.
- **No `!.` in doctests** — the doctest runner doesn't support TypeScript's non-null assertion. Use `?.` instead: `svc.items[0]?.name`.

## Services container

`src/services/index.ts` defines `Services` — a bag of optional service references passed through the server to routes and connectors:

```typescript
export interface Services {
  telegram?: TelegramService | undefined;
  claudeCli?: ClaudeCliService | undefined;
  calendar?: GoogleCalendarService | undefined;
  // ... all optional, not every box configures every service
}
```

In production, services are `undefined` and routes/connectors create real implementations from config. In tests, fakes are injected via `makeTestServer({ services: { telegram: createFakeTelegram(...) } })`.

## Call logging

`withCallLog(service)` wraps any service, recording every method call in a `.callLog` array. Only used on fakes in tests — it's how we verify interactions:

```typescript
const tg = withCallLog(createFakeTelegram({ username: "bot" }));
await tg.sendMessage(123, "hello");
printCalls(tg.callLog);
// => sendMessage(123, "hello")
```

`printCalls(log, methodName?)` formats the log for doctest assertions. Pass a method name to filter.

## Threading through routes

Routes accept optional services in their options object. When provided, the service is used directly. When `undefined`, the route falls back to creating a real implementation (or returns an error if credentials are missing):

```typescript
interface ChatRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  openaiAudio?: OpenAIAudioService | undefined;
}
```

`server.ts` passes `options.services?.foo` to each route.

## Threading through connectors

Connectors accept an optional service in their factory function:

```typescript
export function createTelegramConnector(boxRoot: string, telegram?: TelegramService): Connector
```

Inside the connector, a helper creates the real service from config when no injected service is provided:

```typescript
private getTelegram(botToken: string): TelegramService {
  return this.telegramService ?? createTelegramService(botToken);
}
```

## Testing with fakes

Route tests use `makeTestServer()` from `test/helpers/doctest-server.ts`:

```typescript
const tg = createFakeTelegram({ username: "my_bot" });
const ctx = await makeTestServer({ services: { telegram: tg } });
// ... inject requests, inspect tg.sent, tg.webhookUrl, etc.
await ctx.cleanup();
```

Each service has a doctest in `test/service-*.doctest.md` demonstrating the fake API.

## File inventory

| File | Interface | Real factory | Fake factory |
|------|-----------|-------------|-------------|
| `telegram.ts` | `TelegramService` | `createTelegramService(token)` | `createFakeTelegram({ username })` |
| `claude-cli.ts` | `ClaudeCliService` | `createClaudeCliService()` | `createFakeClaudeCli({ loggedIn? })` |
| `google-auth.ts` | `GoogleAuthService` | `createGoogleAuthService(client)` | `createFakeGoogleAuth({ accessToken? })` |
| `google-calendar.ts` | `GoogleCalendarService` | `createGoogleCalendarService(auth)` | `createFakeGoogleCalendar({ calendars?, events? })` |
| `imap.ts` | `ImapService` | `createImapService({ host, port, user, pass })` | `createFakeImap({ messages? })` |
| `openai-audio.ts` | `OpenAIAudioService` | `createOpenAIAudioService(apiKey)` | `createFakeOpenAIAudio({ transcriptionText? })` |
| `feed-fetcher.ts` | `FeedFetcherService` | `createFeedFetcherService()` | `createFakeFeedFetcher({ feeds? })` |
| `article-fetcher.ts` | `ArticleFetcherService` | `createArticleFetcherService()` | `createFakeArticleFetcher(articles?)` |
| `google-drive.ts` | `GoogleDriveService` | `createGoogleDriveService(auth)` | `createFakeGoogleDrive({ files?, spreadsheets? })` |
| `call-log.ts` | — | — | `withCallLog(service)`, `printCalls(log)` |
| `index.ts` | `Services` container | — | Barrel exports all of the above |
