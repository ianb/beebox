# Testing with check()

Write tests using `t.check(actual, expected)` alongside tap. `check()` compares everything as strings — values are serialized, then matched against an expected string with optional wildcards.

```ts
import { test } from "tap";
import "agent-doctest/tap";
```

The import adds `t.check()` to all tap test objects. It's also loaded automatically via `.taprc` so the import is only needed for TypeScript types.

## Write a test

```ts
test("safeFilename strips special characters", async (t) => {
  t.check(safeFilename("Hello World!"), "Hello_World");
  t.check(safeFilename(""), "untitled");
});
```

Objects are serialized as pretty-printed JSON:

```ts
test("getStatus on clean repo", async (t) => {
  await t.check(getStatus(boxRoot), `{
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
  await t.check(async (print) => {
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

`«»` wildcards match variable text. Named and typed wildcards are self-documenting:

```ts
t.check(commitOutput, "«hash=*» initial commit");
t.check(logLine, "[«date»] «author=*»: created card");
```

## When to use check() vs tap assertions

| Use | For |
|---|---|
| `t.check(val, "expected")` | String-shaped output, rendered content, JSON structures, side-effect sequences |
| `t.equal(a, b)` | Exact value equality (numbers, booleans, specific strings) |
| `t.same(a, b)` | Deep structural equality where you care about the shape, not the text |
| `t.ok(condition)` | Boolean conditions |

They mix freely in the same test.

## What's in the full reference

See [check-reference.md](check-reference.md) for:

- **Serializers** — register custom value-to-string converters for domain types (GitStatus, Card, etc.) so tests read naturally instead of showing raw JSON
- **Options** — `normalizeWhitespace` for messy output, `label` for identifying checks in error messages
- **inspect()** — non-throwing variant that returns `{ pass, actual, expected, diff }` for programmatic use
- **Standalone check()** — the throwing API for non-tap contexts
- **API summary** — full type signatures
