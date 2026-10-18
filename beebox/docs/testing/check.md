# Tests with `t.check`

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
import { any } from "agent-doctest/check";
import { signMobileSession, verifyMobileSession } from "../../../src/core/mobile/session.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

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

Patterns are imported from `agent-doctest/check`. Each pattern is typed:
`any(String)` is accepted only where the actual value is a string.

| Pattern | Matches |
|---|---|
| `any(String)`, `any(Number)`, `any(Boolean)` | any value of that type |
| `.startsWith(s)`, `.endsWith(s)`, `.includes(s)`, `.matches(re)` | refine a string pattern |
| `.int()`, `.between(min, max)`, `.positive()`, `.closeTo(n, tolerance)` | refine a number pattern |
| `uuid()` | a UUID string |
| `isoDate()` | an ISO date or timestamp string, or a valid `Date` |
| `oneOf("a", "b")` | one of the listed values |
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

`t.checkText(actual, text)` compares the value's text. The text may hold
`«»` wildcards (`«int»`, `«uuid»`, `«date»`, `«*»`). Use it for command
output and other text, not for values.

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
- Do not check `a === b` against `true`; check `a` against `b`.
- Check one field only when that field is the whole contract.
- Make the value deterministic before you reach for a pattern: pass a fixed
  clock, a fixed id, a fixed seed.

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
