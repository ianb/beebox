# Tests with `t.check`

**Location:** `test/<area>/<name>.test.ts`, mirroring the `src/` path
**Runner:** [tap](https://node-tap.org/) with the `@ianbicking/tap-check/tap` plugin
**Run:** `pnpm test`, or `pnpm exec tap test/<path>.test.ts` from `beebox/`, frontend tests included (`src/frontend/test/<path>`); tap takes files or a glob, not a directory

A test file is `<name>.test.ts`, run by tap. Each test compares whole values
with `t.check(actual, expected)`. The expected value is written as code, and
the type checker checks it against the actual value's type.

This is the *expect test* pattern ([Jane Street](https://blog.janestreet.com/the-joy-of-expect-tests/);
[matklad](https://matklad.github.io/2021/05/31/how-to-test.html)): state the
whole observed value, so a regression shows as a diff.

## A test file

```ts
// Mobile session cookies: a minted cookie verifies back to its device, and
// every malformed cookie returns null rather than throwing.

import { test } from "tap";
import { any } from "@ianbicking/tap-check/check";
import { signMobileSession, verifyMobileSession } from "../../../src/core/mobile/session.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("a minted cookie verifies back to its device", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const cookie = signMobileSession(box.root, { deviceId: "device-1", createdBy: "owner@example.com", ttlMs: 60_000 });

  // createdBy enforces capture ownership; a cookie without it weakens that check.
  t.check(verifyMobileSession(box.root, cookie), {
    deviceId: "device-1",
    createdBy: "owner@example.com",
    exp: any(Number).int(),
  });
});
```

- A comment at the top says what the file covers. A comment before a check
  says what rule it shows, when the code does not make that plain.
- `t.teardown(...)` releases what the test created.
- `t.check` on a promise returns a promise: `await t.check(fetchIt(), …)`.

## Finding the expected value

Leave the expected value out. The check fails and prints a suggestion:

```ts
t.check(await createNote("Draft"));
```

```
suggested: |-
  {
    id: uuid(),
    title: "Draft",
    created: isoDate(),
  }
generalized: |-
  $.id — UUID string
  $.created — ISO timestamp
```

Read the suggestion before you paste it. It is what the code does now, which
is not always what it should do. `generalized` lists the values it replaced
with patterns. Keep those patterns only where the value really varies between
runs. A fixed clock or a fixed id is a stronger test.

## Matching rules

- **Exact.** An extra key, a missing key, or a different value fails. Key
  order does not matter.
- A key whose value is `undefined` is compared like any other: list it as
  `key: undefined`. A function-valued key (a method or callback) is not
  compared.
- Symbol keys, and objects whose state is private (a class instance with
  no own data, a boxed number, a buffer), cannot be compared. The check
  fails and asks for a projection.
- A class instance compares by its own data, so a plain object literal
  matches it.
- An `Error` compares `name`, `message`, and its own data.
- Arrays, `Map` entries and `Set` members compare in order.
- A `Date` matches an equal `Date`, its ISO string, or `isoDate()`. A
  `RegExp` matches one with the same source and flags.
- Numbers compare with `Object.is`: `NaN` equals `NaN`, and `-0` is not `0`.
- A function or a promise inside the value cannot be compared. Check a
  projection of it instead.

## Patterns

Patterns are imported from `@ianbicking/tap-check/check`. Each pattern is typed:
`any(String)` is accepted only where the actual value is a string.

| Pattern | Matches |
|---|---|
| `any(String)`, `any(Number)`, `any(Boolean)` | any value of that type |
| `.startsWith(s)`, `.endsWith(s)`, `.includes(s)`, `.matches(re)` | refine a string pattern |
| `.int()`, `.between(min, max)` (inclusive), `.below(n)`, `.above(n)` (strict), `.positive()`, `.closeTo(n, tolerance)` | refine a number pattern |
| `uuid()` | a UUID string |
| `isoDate()` | an ISO date or timestamp string, or a valid `Date` |
| `oneOf("a", "b")` | one of the listed values |
| `not(x)`, `not(p)` | any value except `x`, or any value `p` does not match: a new id that must differ from the old one, or text that must not hold a string |
| `is(x)` | exactly `x`: for an object, the same instance, not an equal copy |
| `instanceOf(C)` | an instance of class `C`, such as an error's class |
| `` str`/box/${any(String)}/notes` `` | a string with patterns inside |
| `optional(p)` | a key that may be absent; when present it matches `p`. Accepted only on a property that is optional in the actual value's type |
| `unordered([...])` | an array in any order, each item matched once |
| `containing([...])` | an array that holds these items, in any order, among others |
| `[others]: p` | in an object: every key not listed must match `p` |
| `capture(p)` | matches `p` and keeps the value as `.value` |
| `anything()` | any value except `undefined`; refused as the whole expected value |

A key the expected object does not list fails, unless the object has
`[others]`:

```ts
t.check(counts, { notes: 3, cards: 1, [others]: any(Number) });
```

`capture` relates two values, for example "the list contains the note that
was created":

```ts
const noteId = capture(uuid());
t.check(await createNote("Draft"), { id: noteId, title: "Draft" });
t.check(await listNotes(), [{ id: noteId.value, title: "Draft" }]);
```

`capture` is also how to use a value after checking it. Check the whole
value with captures in it, rather than `t.ok(device)` followed by an
`if (!device) return`:

```ts
const deviceId = capture(any(String));
t.check(await redeemTicket(token), { deviceId, label: "phone" });
await revokeDevice(deviceId.value);
```

## Text and errors

`t.checkText(actual, text)` compares a string, or a promise of one, with
`text`. The text may hold `«»` wildcards (`«int»`, `«uuid»`, `«date»`,
`«*»`). Use it for command output and other text; use `t.check` for values.

```ts
t.checkText(runStatus(), `ready: «int» cards
last sync: «date»`);
```

`t.checkThrows(fn, expected)` checks that `fn` throws or rejects. `"Name"`
checks the error's name; `"Name: message"` checks both.

```ts
await t.checkThrows(() => parseCard("no frontmatter"), "CardParseError: missing frontmatter");
```

## A strong test

- Check the whole value. A test that checks `result.items.length` passes when
  the items are wrong. A test that checks `result.items` does not.
- Do not compare `JSON.stringify(x)`; check `x`.
- Do not check `a === b` against `true`; check `a` against `b`, or
  `t.check(a, is(b))` when `a` must be the same object as `b`.
- Check one field only when that field is the whole contract. The weak
  forms are projections on the left: `.success`, `.ok`, `.length`, `.code`,
  `.status`, `.includes(...)`, `some(...)`, a join or template of fields. A
  function whose return is a boolean or `null` is a whole value already.
- Make the value deterministic before you reach for a pattern: pass a fixed
  clock, a fixed id, a fixed seed.
- Pin the rows the claim names, not a generated set. A directory listing, a
  package file list, an id table, rendered HTML, or a helper's whole output
  pasted as the expected value fails on every intended change to the
  scaffold and catches nothing: on `main` these were most of the red hours
  and none of the regressions. Check the entry the test is about, or the
  derived fact (the count of kinds, the one new name), and say in the
  comment when the claim really is "exactly this set". When the whole value
  would be such a set, a narrowed check is right; say so.
- Do not mirror a constant into expected values. A test that lists every
  row of a catalog or registry restates the source file and fails only when
  the catalog is edited on purpose. Prove the rule on one row and reference
  the exported constant for the rest.
- Pin a library's message by our part of it. For a zod, Markdoc, or Node
  error, check the prefix we add, the path, and the kind
  (``str`...: ${any(String)}` ``); the library's own wording changes with its
  version. Our own messages, the ones a person or an agent reads, are the
  feature and are pinned whole.

## Time, load, and real processes

The full suite runs many files at once on a loaded host. A test that depends
on how fast a child process, the filesystem, or the network responds fails
there.

- A time limit only catches a hang. To claim that a call does not block, check
  the order of events: hold the background work on a gate, and check that the
  caller returned before the gate opened.
- Wait for the final state. A value that is published partway through an
  operation (a status, a phase, a flag) can be seen before the operation ends.
- A real OS event can be lost. Inside the `eventually`, repeat only an action
  that is safe to repeat: rewrite the same file content until the watcher sees
  it; send each probe request on a fresh connection, because a reload closes
  pooled ones. Do not repeat the operation under test (a reload, a deploy), or
  a broken one is hidden. Test our own filtering of events with a fake source.
- Do not cap a child process's memory to prove a limit. A cap fails under load
  for reasons unrelated to the code. Sample the child's live heap during the
  work and check the peak, and the retained heap after it.
- Narrow a system-wide probe (`lsof`, a process list) to the test's own
  process.
- Write a fixture where the external tool writes it, computed independently.
  A fixture built by the helper under test agrees with that helper when both
  are wrong.

## Reading a failure

A failure prints three parts:

- `mismatches`: each difference, with its path (`$.items[2].id`), what was
  expected, and the actual value.
- `diff`: the actual value against the expected value. A pattern that matched
  shows the actual value, so only real differences are marked.
- `suggested`: the expected value rewritten to match. The patterns that
  matched are kept.

Fix the code when the behavior is wrong. Fix the expected value when the
behavior is right.

## Helpers

- `test/helpers/test-helpers.ts`: `makeTmpBox()` for filesystem tests. It
  returns `.root`, `.list()`, `.read()`, `.write()`, `.commitAll()`, and
  `.cleanup()`. `list()` returns relative paths, so no temp directory names
  reach an expected value.
- `test/helpers/test-route-server.ts`: `makeTestServer()` for route tests. It
  returns `.inject()` (text), `.request()` (parsed object), `.seed()`,
  `.read()`, `.commitAll()`, and `.cleanup()`. It uses Fastify `inject()`, so
  no socket opens. `.request()` and `.inject()` prefix URLs with the test box
  slug (`/test`). `.rootRequest()` hits a root-level route without the prefix.
- `eventually(fn, { label })`, from `@ianbicking/tap-check/check`, waits for a
  condition. Never use a fixed sleep.

## Service fakes

External dependencies (APIs, CLIs) sit behind typed service interfaces with
in-memory fakes. The service layer is documented in `src/services/AGENTS.md`.
Each service has an interface (the subset we use), a real factory, and a fake
factory with domain-specific constructor parameters and observable state:

```ts
const cal = createFakeGoogleCalendar({ calendars: [{ id: "primary", summary: "Home" }] });
await cal.insertEvent("primary", { summary: "Dentist", start, end });
t.check(cal.events.length, 1);
```

Pass fakes to a route with `makeTestServer({ services: { calendar: cal } })`,
then check what the route did through the fake's state.

| Service | Factory | Key constructor params | Observable state |
|---------|---------|----------------------|-----------------|
| Claude CLI | `createFakeClaudeCli()` | `{ loggedIn? }` | `.loggedIn` |
| Google Calendar | `createFakeGoogleCalendar()` | `{ calendars?, events? }` | `.calendars[]`, `.events[]` |
| OpenAI Audio | `createFakeOpenAIAudio()` | `{ transcriptionText? }` | `.calls[]` |
| IMAP | `createFakeImap()` | `{ messages? }` | `.connected`, `.lockedMailbox` |
| Google Auth | `createFakeGoogleAuth()` | `{ accessToken? }` | none |

A connector test uses `makeTmpBox({ git: true })`, seeds config files, injects
a fake, and runs `sync()`. Credentials go through the machine secret store
([secrets](../secrets.md)): `setSecret` and `grantSecret`
(`src/core/secrets/lifecycle.ts`) do what `bbx secrets set` and `grant` do.

```ts
const box = await makeTmpBox({ git: true });
t.teardown(() => box.cleanup());
await initBox(box.root);
box.commitAll("init box");
await setSecret({ name, value });
await grantSecret({ slug, name, access: "server" });

const connector = createGmailConnector(box.root, createFakeGoogleGmail({ messages }));
await t.check(connector.sync(), { created: 1, updated: 0, pushed: 0 });
```

## DOM tests

A frontend test can render a component two ways. `renderToStaticMarkup`
(`react-dom/server`) shows the first render's HTML and runs no effects.
`mount()` mounts the component in a [happy-dom](https://github.com/capricorn86/happy-dom)
document, from `src/frontend/test/helpers/dom-harness.ts`. Use `mount()` for
what only a live tree shows: effects and their cleanups, event handlers, state
across re-renders, and which components re-render.

Every test process loads frontend modules through the React Compiler, with the
options the Vite build uses (`src/frontend/test/helpers/react-compiler-hooks.ts`,
registered in `.taprc`). Memoization in a test therefore matches the browser.
`REACT_COMPILER=0` turns it off for debugging. Compiled modules are cached in
`src/frontend/node_modules/.cache/`.

- Import `dom-harness.js` first. React DOM reads the window and the
  render-count hook when it loads. `mount()` throws `HarnessLoadOrderError` if
  React DOM loaded first.
- Change state through the handle: `rerender(element)` as a parent would, or
  `act(fn)` for a setter or an event. Both resolve after effects flush.
- `renders()` counts committed renders per component name since mount or
  `resetRenders()`. Reset after the setup renders, then check the exact counts
  for the step under test. An exact object catches a component that starts
  rendering.
- End each test with `unmount()` (or `t.teardown`), so the cleanups run. A
  test `QueryClient` sets `gcTime: Infinity` for mutations as well as queries;
  a mutation's default 5-minute timer keeps the test process alive.
- A component that calls `useParams` needs a router around it, as in
  `src/frontend/test/components/PersonView.person-view.test.ts`.

```ts
import { mount } from "../helpers/dom-harness.js";
import { createElement as h, useState } from "react";

function Counter() {
  const [n, setN] = useState(0);
  return h("button", { onClick: () => setN(n + 1) }, `clicked ${n}`);
}

void test("a click re-renders the counter once", async (t) => {
  const view = await mount(h(Counter));
  t.teardown(() => view.unmount());
  await view.act(() => view.container.querySelector("button")?.click());
  t.check({ text: view.container.textContent, renders: view.renders() }, {
    text: "clicked 1",
    renders: { Counter: 2 },
  });
});
```

Render counts cover committed renders of ordinary trees. An aborted render is
not counted, and Suspense fallbacks get no special handling.
