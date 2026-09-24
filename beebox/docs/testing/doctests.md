# Doctests
**Location:** `test/*.doctest.md`
**Runner:** TAP with a custom Node.js loader (the monorepo's `agent-doctest` package — loader hook at `agent-doctest/src/doctest-hooks.ts`, exposed via the `agent-doctest/hooks` export)
**Run:** `pnpm test` (runs alongside traditional tests)

Doctest files are executable markdown documents. The prose explains behavior; fenced code blocks contain examples that are run as tests. A Node.js loader hook transforms them into TAP tests at runtime.

**When to use:** The default for most testing. Pure functions, template generators, stateful sequences with setup helpers, anything where showing examples is more readable than `t.equal()` assertions.

**Syntax:** See [doctest syntax](../../../agent-doctest/docs/syntax.md) for the full reference.

````markdown
```ts setup
import { initBox, isValidBox } from "../src/core/box/index.js";
```

## Creating a box

`initBox` creates the directory structure:

```
const tmp = await makeTmpDir();
await initBox(tmp, { skipGit: true });
await isValidBox(tmp)
=> true
```
````

**Features:**
- `t.check()` wildcards in expected values: `«*»` (anything), `«date»`, `«int»`, `«name»`, `«name=type»`
- ```` ``` continue ```` blocks share scope with the previous block (for prose between related code)
- ```` ``` cleanup ```` blocks register teardown code via `t.teardown()` — runs after the test even on failure
- Lines ending with `;` are statements; the last non-`;` line is the checked expression
- Setup blocks run at module scope for imports and helpers
- `print()` — scope-local function for building narrative output (see below)

**`print()` for storytelling:**

Each test gets its own `print` function. Lines accumulate and drain into the next `=>` assertion, combined with the expression result. Useful for building up narrative output across multiple steps:

````markdown
```
const result = await runProcedure(params);
print(`status: ${result.success}`);
for (const step of steps) {
  print(`${step.id}: ${step.status}`);
};
"done"
=>
status: true
fetch: completed
analyze: skipped
done
```
````

When `print()` isn't called, behavior is unchanged — the expression result is checked directly. `print()` returns void, so `print("last line")` as the expression adds the line without appending an extra value.

**Shared helpers:**
- `test/helpers/doctest-helpers.ts` — `makeTmpBox()` for filesystem tests. Returns `.root`, `.list()`, `.read()`, `.write()`, `.cleanup()`. All output is relative paths (no temp dir names in expected output).
- `test/helpers/doctest-server.ts` — `makeTestServer()` for route tests. Returns `.inject()` (string for check), `.request()` (parsed object), `.seed()`, `.read()`, `.commitAll()`, `.cleanup()`. Uses Fastify `inject()` internally — no socket server. `.request()`/`.inject()` prefix URLs with the test box slug (`/test`); use `.rootRequest()` to hit a root-level route without that prefix.

**Current doctest files:**

| File | Tests |
|------|-------|
| `test/core/box.doctest.md` | `initBox()`, directory structure, `isValidBox()`, `findBoxRoot()`, metadata |
| `test/schemas/schemas.doctest.md` | Schema registry, card templates (memo, question, intake-job, calendar-review-job) |
| `test/connectors/intake-utils.doctest.md` | `createOrAppendIntakeJob()` — create, append, multi-source |
| `test/connectors/calendar-utils.doctest.md` | ICS parsing, event formatting, timespan parsing, date filtering |
| `test/core/chat-response-extraction.doctest.md` | `<chat-response>` streaming extraction, chunking, multiline |
| `test/connectors/chat-utils.doctest.md` | Chat utilities |
| `test/schemas/scheduled-script.doctest.md` | `isDue()`, `isDueForWakeup()`, `isWithinBudget()`, template generation |
| `test/core/schedule-state.doctest.md` | `pruneRecentRuns()`, `recordRun()` |
| `test/cli/lib/format.doctest.md` | `stripAnsi()` |
| `test/core/procedure/dedent.doctest.md` | `dedent()` |
| `test/serialize.doctest.md` | Value serialization |
| `test/cli/lib/paths.doctest.md` | Card name parsing |
| `test/webapp/routes/routes-scheduler.doctest.md` | Scheduler log and schedules listing API |
| `test/webapp/routes/routes-admin.doctest.md` | Box config admin API |
| `test/webapp/routes/routes-api.doctest.md` | Core data API (status, inbox, cards, browse, debug-log, activity) |
| `test/webapp/routes/routes-commands.doctest.md` | Command listing, details, sync execution, error cases |
| `test/webapp/routes/routes-history.doctest.md` | Git commit log, diffs, session log |
| `test/webapp/routes/routes-actions.doctest.md` | Answer question, create card, validation |
| `test/webapp/routes/routes-clerk.doctest.md` | Clerk extension API (memo, save-to-brief, save-page, tabs, actions) |
| `test/frontend/lib/parse-tags.doctest.md` | XML-like tag parsing (frontend) |
| `test/frontend/lib/patmatch.doctest.md` | Keyword pattern matching (frontend) |
| `test/frontend/lib/speech-parsing.doctest.md` | Speech tag extraction for TTS (frontend) |
| `test/frontend/lib/speech-keywords.doctest.md` | Voice command keyword detection (frontend) |
| `test/print.doctest.md` | `print()` function in doctests (meta-test) |
| `test/core/procedure/procedure-engine.doctest.md` | Procedure engine: shell steps, precheck skip/fail, validation, agent mock, fallback commits |
| `test/cli/lib/git.doctest.md` | Git command helpers (init, commit, log, diff, status, branches, tags) |
| `test/cli/lib/time.doctest.md` | Stubbable time utilities (BBX_TIME env, stubs.yaml, caching) |
| `test/webapp/routes/routes-calendar.doctest.md` | Calendar config routes (list available, get/save config) |
| `test/services/service-call-log.doctest.md` | Generic `withCallLog()` wrapper for recording method calls |
| `test/services/service-telegram.doctest.md` | Telegram service fake (outbox, webhook, polling) |
| `test/services/service-google-calendar.doctest.md` | Google Calendar service fake (calendars, events) |
| `test/services/service-openai-audio.doctest.md` | OpenAI audio service fake (transcription, TTS) |
| `test/service-imap.doctest.md` | IMAP service fake (connect, search, fetch) |
| `test/connectors/connector-telegram.doctest.md` | Telegram connector: extractMessage, webhook processing, full sync, outbound send |

# Testing with Service Fakes

External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full service layer docs: `src/services/CLAUDE.md`.

## Pattern

Every external service has three parts:

1. **Interface** — the subset of the API we actually use
2. **Real factory** — thin wrapper around the library, created from config
3. **Fake factory** — domain-specific in-memory implementation for tests

```typescript
// Create a fake with domain-specific constructor params
const tg = createFakeTelegram({ username: "test_bot" });

// Fakes have observable state
await tg.sendMessage(123, "hello");
tg.sent.length  // => 1
tg.sent[0].text // => "hello"
```

## Injecting into routes

Pass fakes via `makeTestServer({ services: { ... } })`:

```typescript
const tg = createFakeTelegram({ username: "my_bot" });
const ctx = await makeTestServer({ services: { telegram: tg } });
// Routes that use telegram will get the fake
const res = await ctx.request({ method: "GET", url: "/api/admin/telegram-status" });
// Inspect what the route did via the fake's state
tg.sent  // messages the route sent
```

## Call logging

Wrap any fake with `withCallLog()` to record method calls:

```typescript
const tg = withCallLog(createFakeTelegram({ username: "bot" }));
await tg.sendMessage(123, "hello");
printCalls(tg.callLog);
// => sendMessage(123, "hello")
```

## Available fakes

| Service | Factory | Key constructor params | Observable state |
|---------|---------|----------------------|-----------------|
| Telegram | `createFakeTelegram()` | `{ username }` | `.sent[]`, `.webhookUrl` |
| Claude CLI | `createFakeClaudeCli()` | `{ loggedIn? }` | `.loggedIn` |
| Google Calendar | `createFakeGoogleCalendar()` | `{ calendars?, events? }` | `.calendars[]`, `.events[]` |
| OpenAI Audio | `createFakeOpenAIAudio()` | `{ transcriptionText? }` | `.calls[]` |
| IMAP | `createFakeImap()` | `{ messages? }` | `.connected`, `.lockedMailbox` |
| Google Auth | `createFakeGoogleAuth()` | `{ accessToken? }` | — |

## Connector testing pattern

Connector tests use `makeTmpBox({ git: true })` to create a temp box with git, seed config files, inject a service fake, and run `sync()`. Credentials go through the machine secret store (`docs/secrets.md`), not a seeded box file — `setSecret`/`grantSecret` (`src/core/secrets/lifecycle.js`) put a value in and grant it to the box's slug, same as `bbx secrets set`/`grant` would:

```typescript
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");
await setSecret({ name: `telegram-bot/${slug}`, value: JSON.stringify({...}) });
await grantSecret({ slug, name: `telegram-bot/${slug}`, access: "server" });

const tg = createFakeTelegram({ username: "bot", updates: [...] });
const connector = createTelegramConnector(box.root, tg);
const result = await connector.sync();
// Check result.created, result.updated, result.pushed
// Check tg.sent for outbound messages
await box.cleanup();
```

## Doctest limitations

Doctest blocks are full TypeScript (compiled via esbuild's `ts` loader) — `import type`, non-null assertions, and type annotations all work, in setup and test blocks alike. The real limitations are structural: assertions compare serialized output (see the string-comparison rules in [doctest syntax](../../../agent-doctest/docs/syntax.md)), and code blocks can't express trailing newlines.
