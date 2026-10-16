# Doctests

Executable markdown: the prose explains the behavior and the fenced blocks
run as tests. The default test form.

## What it is

**Location:** `test/*.doctest.md`
**Runner:** TAP with a custom Node.js loader (the monorepo's `agent-doctest` package — loader hook at `agent-doctest/src/doctest-hooks/hooks.ts`, exposed via the `agent-doctest/hooks` export)
**Run:** `pnpm test` (runs alongside traditional tests)

Doctest files are executable markdown documents. The prose explains behavior; fenced code blocks contain examples that are run as tests. A Node.js loader hook transforms them into TAP tests at runtime.

**When to use:** The default for most testing. Pure functions, template generators, stateful sequences with setup helpers, anything where showing examples is more readable than `t.equal()` assertions.

**Syntax:** See [doctest syntax](../../../agent-doctest/docs/syntax.md) for the full reference.

## Writing one

Create `test/<area>/<name>.doctest.md` mirroring the source path. It runs with
the suite and is selected by `pnpm test:changed` when its subject changes.

````markdown
```ts setup
import { initBox, isValidBox } from "../src/core/box/structure/core.js";
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

External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full service layer docs: `src/services/AGENTS.md`.

### Pattern

Every external service has three parts:

1. **Interface** — the subset of the API we actually use
2. **Real factory** — thin wrapper around the library, created from config
3. **Fake factory** — domain-specific in-memory implementation for tests

```typescript
// Create a fake with domain-specific constructor params
const cal = createFakeGoogleCalendar({ calendars: [{ id: "primary", summary: "Home" }] });

// Fakes have observable state
await cal.insertEvent("primary", { summary: "Dentist", start: {...}, end: {...} });
cal.events.length  // => 1
```

### Injecting into routes

Pass fakes via `makeTestServer({ services: { ... } })`:

```typescript
const cal = createFakeGoogleCalendar({ calendars: [...] });
const ctx = await makeTestServer({ services: { calendar: cal } });
// Routes that use the calendar service will get the fake
// Inspect what the route did via the fake's state
cal.events  // events the route inserted
```

### Available fakes

| Service | Factory | Key constructor params | Observable state |
|---------|---------|----------------------|-----------------|
| Claude CLI | `createFakeClaudeCli()` | `{ loggedIn? }` | `.loggedIn` |
| Google Calendar | `createFakeGoogleCalendar()` | `{ calendars?, events? }` | `.calendars[]`, `.events[]` |
| OpenAI Audio | `createFakeOpenAIAudio()` | `{ transcriptionText? }` | `.calls[]` |
| IMAP | `createFakeImap()` | `{ messages? }` | `.connected`, `.lockedMailbox` |
| Google Auth | `createFakeGoogleAuth()` | `{ accessToken? }` | — |

### Connector testing pattern

Connector tests use `makeTmpBox({ git: true })` to create a temp box with git, seed config files, inject a service fake, and run `sync()`. Credentials go through the machine secret store (`docs/secrets.md`), not a seeded box file — `setSecret`/`grantSecret` (`src/core/secrets/lifecycle.ts`) put a value in and grant it to the box's slug, same as `bbx secrets set`/`grant` would:

```typescript
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");
await setSecret({ name, value });
await grantSecret({ slug, name, access: "server" });

const gmail = createFakeGoogleGmail({ messages: [...] });
const connector = createGmailConnector(box.root, gmail);
const result = await connector.sync();
// Check result.created, result.updated, result.pushed
await box.cleanup();
```

## DOM doctests

A frontend doctest can render a component two ways. `renderToStaticMarkup`
(`react-dom/server`) shows the first render's HTML and runs no effects. A DOM
doctest mounts the component in a [happy-dom](https://github.com/capricorn86/happy-dom)
document with `mount()`, from
`src/frontend/test/components/helpers/dom-harness.ts`. Use it for what only a
live tree shows: effects and their cleanups, event handlers, state across
re-renders, and which components re-render.

Every test process loads frontend modules through the React Compiler, with
the options the Vite build uses (`src/frontend/test/helpers/react-compiler-hooks.ts`,
registered in `.taprc`). Memoization in a doctest therefore matches the
browser under the normal build, which runs the compiler (`REACT_COMPILER=0`
turns it off for debugging). Compiled modules are cached in `src/frontend/node_modules/.cache/`.

Rules:

- Import `dom-harness.js` first in the setup block. React DOM reads the
  window and the render-count hook when it loads; `mount()` throws
  `HarnessLoadOrderError` if React DOM loaded first.
- Change state through the handle: `rerender(element)` as a parent would,
  or `act(fn)` for a setter or an event. Both resolve after effects flush.
- `renders()` counts committed renders per component name since mount or
  `resetRenders()`. Reset after the setup renders, then assert the exact
  counts for the step under test; an exact object catches a component that
  starts rendering.
- End each example with `unmount()`, so the component's cleanups run.
- A component that calls `useParams` needs a router around it, as in
  `src/frontend/test/components/PersonView.person-view.doctest.md`.

````markdown
```ts setup
import { mount } from "./helpers/dom-harness.js";
import { createElement as h, useState } from "react";

function Counter() {
  const [n, setN] = useState(0);
  return h("button", { onClick: () => setN(n + 1) }, `clicked ${n}`);
}
```

```ts
const view = await mount(h(Counter));
await view.act(() => view.container.querySelector("button").click());
const seen = { text: view.container.textContent, renders: view.renders() };
await view.unmount();
seen
=> { text: "clicked 1", renders: { Counter: 2 } }
```
````

Render counts cover committed renders of ordinary trees: an aborted render
is not counted, and Suspense fallbacks get no special handling.

## Failure modes

Doctest blocks are full TypeScript (compiled via esbuild's `ts` loader) — `import type`, non-null assertions, and type annotations all work, in setup and test blocks alike. The real limitations are structural: assertions compare serialized output (see the string-comparison rules in [doctest syntax](../../../agent-doctest/docs/syntax.md)), and code blocks can't express trailing newlines.
