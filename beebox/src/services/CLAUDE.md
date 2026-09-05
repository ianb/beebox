# Services

**Rule of thumb:** if a library or function touches external things — network, filesystem outside the box, child processes, real time — wrap it in a service. The wrapping lets tests substitute a fake.

A service has three parts in one file:

1. **Interface** — the subset of the external API we actually call (not the full surface).
2. **Real implementation** — `createFooService(...)` returning the interface, calling the actual external thing.
3. **Fake implementation** — `createFakeFoo(...)` returning the interface (or an extended one), backed by in-memory state.

## Pattern

```typescript
// Interface — only the methods we call
export interface FooService {
  doThing(id: string): Promise<Result>;
}

// Real — wraps the library
export function createFooService(token: string): FooService { ... }

// Fake — takes a named-params object
export interface FakeFooOptions {
  items?: Item[];
}
export function createFakeFoo(opts?: FakeFooOptions): FakeFooService { ... }

// Fake extends the interface with whatever state tests want to observe.
// Always include describe() so doctests can print a stable snapshot.
export interface FakeFooService extends FooService {
  items: Item[];
  sent: Message[];
  describe(): string;
}
```

## Design rules

- **Always named-params, never positional.** Even for one-input fakes — call `createFakeFoo({ items: [...] })`, not `createFakeFoo([...])`. Keeps call sites uniform and lets you add fields later without breaking callers.
- **Extend the interface as tests need it.** If tests want to inspect what happened (sent messages, fetched URLs, written files), declare a `FakeFooService extends FooService` with the relevant fields. If tests don't need it, returning the bare `FooService` is fine — `withCallLog(svc)` covers generic "did this method get called" observation without baking state into the fake.
- **Provide a `describe(): string` method on the fake.** Returns a multi-line, stable, human-readable snapshot of the fake's current state. Doctests then `print(fake.describe())` and match. Avoids per-test `JSON.stringify` boilerplate and makes failures legible.
- **Fakes are domain-specific**, not generic `Partial<T>` overrides. Constructor params reflect what the service needs to function (e.g. `createFakeTelegram({ username: "bot" })` requires a username because `getMe()` returns it).
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

## Threading through callers

Routes and connectors both accept optional services from their caller. When the service is provided, it's used directly; when `undefined`, the caller creates a real implementation from config (or errors if credentials are missing). `server.ts` passes `options.services?.foo` down to each.

```typescript
// Route options object
interface ChatRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  openaiAudio?: OpenAIAudioService | undefined;
}

// Connector factory parameter
export function createTelegramConnector(boxRoot: string, telegram?: TelegramService): Connector

// Fallback inside the connector
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
| `google-auth.ts` | `GoogleAuthService` | `createGoogleAuthService(client, { boxRoot? })` | `createFakeGoogleAuth({ accessToken? })` |
| `google-calendar.ts` | `GoogleCalendarService` | `createGoogleCalendarService(auth)` | `createFakeGoogleCalendar({ calendars?, events? })` |
| `google-gmail.ts` (fake in `google-gmail-fake.ts`) | `GoogleGmailService` | `createGoogleGmailService(auth)` | `createFakeGoogleGmail({ messages?, labels?, attachments?, historyId?, oldestValidHistoryId?, historyRecords? })` |
| `openai-audio.ts` | `OpenAIAudioService` | `createOpenAIAudioService(apiKey)` | `createFakeOpenAIAudio({ transcriptionText? })` |
| `openai-embeddings.ts` | `EmbeddingsService` | `createOpenAIEmbeddingsService(apiKey)` | `createFakeEmbeddings({ failTimes? })` |
| `google-drive.ts` | `GoogleDriveService` | `createGoogleDriveService(auth)` | `createFakeGoogleDrive({ files?, spreadsheets? })` |
| `claude-chat.ts` | `ChatBackend` | `createChatBackend()` | `createFakeChatBackend()` |
| `call-log.ts` | — | — | `withCallLog(service)`, `printCalls(log)` |
| `index.ts` | `Services` container | — | — (the container only; import each factory from its own file) |

`claude-chat.ts` is not part of the `Services` container — chat session code imports the backend directly. It wraps `@anthropic-ai/claude-agent-sdk`'s `query()` so the chat session can push user content and iterate SDK message events; the fake gives tests a scriptable handle (no SDK call, no subprocess). Still follows the interface/real/fake pattern.
