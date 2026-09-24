# Doctests

Executable markdown: the prose explains the behavior and the fenced blocks
run as tests. The default test form.

## What it is

**Location:** `test/*.doctest.md`
**Runner:** TAP with a custom Node.js loader (the monorepo's `agent-doctest` package — loader hook at `agent-doctest/src/doctest-hooks.ts`, exposed via the `agent-doctest/hooks` export)
**Run:** `pnpm test` (runs alongside traditional tests)

Doctest files are executable markdown documents. The prose explains behavior; fenced code blocks contain examples that are run as tests. A Node.js loader hook transforms them into TAP tests at runtime.

**When to use:** The default for most testing. Pure functions, template generators, stateful sequences with setup helpers, anything where showing examples is more readable than `t.equal()` assertions.

**Syntax:** See [doctest syntax](../../../agent-doctest/docs/syntax.md) for the full reference.

## Writing one

Create `test/<area>/<name>.doctest.md` mirroring the source path. It runs with
the suite and is selected by `pnpm test:changed` when its subject changes.

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

The files themselves are the catalog: `ls test/**/*.doctest.md`.

### Service fakes

External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full service layer docs: `src/services/CLAUDE.md`.

### Pattern

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

### Injecting into routes

Pass fakes via `makeTestServer({ services: { ... } })`:

```typescript
const tg = createFakeTelegram({ username: "my_bot" });
const ctx = await makeTestServer({ services: { telegram: tg } });
// Routes that use telegram will get the fake
const res = await ctx.request({ method: "GET", url: "/api/admin/telegram-status" });
// Inspect what the route did via the fake's state
tg.sent  // messages the route sent
```

### Call logging

Wrap any fake with `withCallLog()` to record method calls:

```typescript
const tg = withCallLog(createFakeTelegram({ username: "bot" }));
await tg.sendMessage(123, "hello");
printCalls(tg.callLog);
// => sendMessage(123, "hello")
```

### Available fakes

| Service | Factory | Key constructor params | Observable state |
|---------|---------|----------------------|-----------------|
| Telegram | `createFakeTelegram()` | `{ username }` | `.sent[]`, `.webhookUrl` |
| Claude CLI | `createFakeClaudeCli()` | `{ loggedIn? }` | `.loggedIn` |
| Google Calendar | `createFakeGoogleCalendar()` | `{ calendars?, events? }` | `.calendars[]`, `.events[]` |
| OpenAI Audio | `createFakeOpenAIAudio()` | `{ transcriptionText? }` | `.calls[]` |
| IMAP | `createFakeImap()` | `{ messages? }` | `.connected`, `.lockedMailbox` |
| Google Auth | `createFakeGoogleAuth()` | `{ accessToken? }` | — |

### Connector testing pattern

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

## Failure modes

Doctest blocks are full TypeScript (compiled via esbuild's `ts` loader) — `import type`, non-null assertions, and type annotations all work, in setup and test blocks alike. The real limitations are structural: assertions compare serialized output (see the string-comparison rules in [doctest syntax](../../../agent-doctest/docs/syntax.md)), and code blocks can't express trailing newlines.
