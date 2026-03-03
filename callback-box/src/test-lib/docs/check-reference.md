# check() — String-comparison testing primitive

`check(actual, expected)` is a testing assertion that compares values as strings. Everything becomes text before comparison. This makes tests readable, diff-friendly, and natural for testing rendered output, serialized data, and side effects.

It coexists with tap's `t.equal()`/`t.same()` — use `check()` when you care about "does this look right as text?", use tap for structural equality.

## Setup

Import `tap-check.js` to add `t.check()` to all tap test objects. It patches `TestBase.prototype` via declaration merging and routes failures through `t.fail()` for clean YAML diagnostics:

```ts
import { test } from "tap";
import "../src/test-lib/tap-check.js";

test("example", async (t) => {
  t.check(someValue, "expected output");
});
```

The import is needed for TypeScript types. At runtime, `t.check()` is also loaded automatically via `.taprc`'s `--import` node-arg.

## Basic usage

Pass any value and the expected string:

```ts
t.check(safeFilename("Hello World!"), "Hello_World");

t.check(42, "42");

t.check({ name: "Alice", age: 30 }, `{
  "name": "Alice",
  "age": 30
}`);
```

Non-string values are serialized automatically — objects become pretty-printed JSON, primitives use `String()`. See [Serializers](#serializers) for customization.

On mismatch, the diff appears in tap's YAML diagnostics:

```
not ok 1 - check failed
  ---
  diff: |-
    expected: "Hello_World"
      actual: "hello_world"
      ~~~~~~~~^
  found: hello_world
  wanted: Hello_World
  source: |
      t.check(result, "Hello_World");
      ----^
  ...
```

Multi-line mismatches get a line-by-line diff:

```
  diff: |-
    expected vs actual:
        {
      -   "name": "Bob",
      +   "name": "Alice",
          "age": 30
        }
```

## Promises

When `actual` is a Promise, `check()` returns a Promise. Await it:

```ts
await t.check(getStatus(boxRoot), `{
  "staged": [],
  "modified": [],
  "untracked": [],
  "clean": true
}`);
```

## Functions with printer

When `actual` is a function, it receives a `print` callback as its first argument. Printed lines become part of the "actual" string, followed by the serialized return value (if non-void):

```ts
t.check((print) => {
  writeFileSync("test.txt", "hello");
  print("wrote: test.txt");
  return readFileSync("test.txt", "utf-8");
}, `wrote: test.txt
hello`);
```

The output is: all `print()` lines joined by newlines, then the serialized return value appended on its own line.

This is the pattern for testing side effects — the function does something, `print()` describes what happened, and the expected string captures both the side effects and the result.

Async functions work too:

```ts
await t.check(async (print) => {
  await writeCard(boxRoot, "inbox/test.card", content);
  print("created: inbox/test.card");
  return await getStatus(boxRoot);
}, `created: inbox/test.card
{
  "staged": [],
  "modified": ["box/inbox/test.card"],
  "untracked": [],
  "clean": false
}`);
```

## Wildcards

Use `___` in the expected string to match any text:

```ts
t.check(timestamp, "2026-___");              // matches any suffix
t.check(commitLine, "___ initial commit");   // matches any prefix
t.check(logLine, "commit ___ by ___");       // multiple wildcards
```

Named wildcards like `___date___` and `___hash___` work the same way but are self-documenting:

```ts
t.check(logEntry, "[___date___] commit ___hash___: initial commit");
```

Both `___` and `___name___` match any sequence of characters including newlines.

## Serializers

Values are converted to strings for comparison using a chain of serializers. The built-in chain:

1. **Registered serializers** (tried in order, first non-null wins)
2. **Strings** pass through unchanged
3. **null/undefined** become `"null"` / `"undefined"`
4. **Objects** become `JSON.stringify(value, null, 2)`
5. **Everything else** uses `String(value)`

Register domain-specific serializers for readable test output:

```ts
import { registerSerializer } from "../src/test-lib/check.js";

registerSerializer((value) => {
  if (value && typeof value === "object" && "staged" in value && "clean" in value) {
    const s = value as GitStatus;
    if (s.clean) return "git: clean";
    const parts = [];
    if (s.staged.length) parts.push(`staged: ${s.staged.join(", ")}`);
    if (s.modified.length) parts.push(`modified: ${s.modified.join(", ")}`);
    if (s.untracked.length) parts.push(`untracked: ${s.untracked.join(", ")}`);
    return `git: ${parts.join("; ")}`;
  }
  return null;
});

// Now tests read naturally:
t.check(await getStatus(boxRoot), "git: clean");
t.check(await getStatus(boxRoot), "git: modified: box/inbox/test.card");
```

Return `null` from a serializer to pass through to the next one.

## Options

Pass a `CheckOptions` object as the second argument instead of a string:

```ts
t.check(messyOutput, {
  expected: "hello world",
  normalizeWhitespace: true,  // collapse whitespace runs, trim
  label: "greeting output",   // appears in error messages
});
```

| Option | Type | Description |
|---|---|---|
| `expected` | `string` | The expected string (required) |
| `normalizeWhitespace` | `boolean` | Collapse tabs/spaces to single space, trim each line |
| `label` | `string` | Added to error message for identification |

## inspect()

`inspect()` is the non-throwing variant — same comparison logic, returns a result object instead of failing:

```ts
import { inspect } from "../src/test-lib/check.js";

const r = inspect("actual", "expected");
r.pass;     // false
r.diff;     // the visual diff string
r.actual;   // "actual"
r.expected; // "expected"
r.message;  // "check failed"
```

Useful for testing the diff format itself, or for programmatic comparison where you don't want assertion failures.

## Standalone check()

The standalone `check()` (from `check.js`, not `tap-check.js`) throws `CheckError` on mismatch instead of calling `t.fail()`. Use this in non-tap contexts or when you need to catch failures yourself:

```ts
import { check, CheckError } from "../src/test-lib/check.js";

try {
  check(result, "expected");
} catch (err) {
  if (err instanceof CheckError) {
    err.diff;    // visual diff string
    err.found;   // serialized actual value
    err.wanted;  // expected string
  }
}
```

## API summary

```ts
// Tap integration (preferred in tests)
import "../src/test-lib/tap-check.js";
t.check(actual: unknown, expected: string | CheckOptions): void | Promise<void>

// Standalone (throws on mismatch)
import { check } from "../src/test-lib/check.js";
check(actual: unknown, expected: string | CheckOptions): void | Promise<void>

// Non-throwing
import { inspect } from "../src/test-lib/check.js";
inspect(actual: unknown, expected: string | CheckOptions): CheckResult | Promise<CheckResult>

// Serializers
serialize(value: unknown): string
registerSerializer(fn: (value: unknown) => string | null): void

// Types
type PrintFn = (text: string) => void
interface CheckOptions { expected: string; normalizeWhitespace?: boolean; label?: string }
interface CheckResult { pass: boolean; actual: string; expected: string; diff: string | null; message: string }
class CheckError extends Error { diff: string; found: string; wanted: string }
```
