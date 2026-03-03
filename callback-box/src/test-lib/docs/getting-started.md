# Testing with check()

Write tests using `check(actual, expected)` alongside tap. `check()` compares everything as strings — values are serialized, then matched against an expected string with optional wildcards.

```ts
import { test } from "tap";
import { check } from "../src/test-lib/check.js";
```

## Write a test

```ts
test("safeFilename strips special characters", async (t) => {
  check(safeFilename("Hello World!"), "Hello_World");
  check(safeFilename(""), "untitled");
});
```

Objects are serialized as pretty-printed JSON:

```ts
test("getStatus on clean repo", async (t) => {
  await check(getStatus(boxRoot), `{
  "staged": [],
  "modified": [],
  "untracked": [],
  "clean": true
}`);
});
```

## Test side effects with the printer

When `actual` is a function, it receives a `print` callback. Printed lines + the return value become the "actual" string:

```ts
test("creating a card modifies git status", async (t) => {
  await check(async (print) => {
    await fs.writeFile(path.join(boxRoot, "box/inbox/test.card"), content);
    print("wrote: box/inbox/test.card");
    return await getStatus(boxRoot);
  }, `wrote: box/inbox/test.card
{
  "staged": [],
  "modified": [],
  "untracked": ["box/inbox/test.card"],
  "clean": false
}`);
});
```

## Use wildcards for volatile values

`___` matches any text. Named wildcards like `___hash___` are self-documenting:

```ts
check(commitOutput, "___hash___ initial commit");
check(logLine, "[___date___] ___author___: created card");
```

## When to use check() vs tap assertions

| Use | For |
|---|---|
| `check(val, "expected")` | String-shaped output, rendered content, JSON structures, side-effect sequences |
| `t.equal(a, b)` | Exact value equality (numbers, booleans, specific strings) |
| `t.same(a, b)` | Deep structural equality where you care about the shape, not the text |
| `t.ok(condition)` | Boolean conditions |

They mix freely in the same test.

## What's in the full reference

See [check-reference.md](check-reference.md) for:

- **Serializers** — register custom value-to-string converters for domain types (GitStatus, Card, etc.) so tests read naturally instead of showing raw JSON
- **Options** — `normalizeWhitespace` for messy output, `label` for identifying checks in error messages
- **Error handling** — `CheckError` class, stack trace behavior, how it integrates with test runners
- **API summary** — full type signatures
