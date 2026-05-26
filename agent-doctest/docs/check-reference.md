# check() — String-comparison testing primitive

`check(actual, expected)` is a testing assertion that compares values as strings. Everything becomes text before comparison. This makes tests readable, diff-friendly, and natural for testing rendered output, serialized data, and side effects.

It coexists with tap's `t.equal()`/`t.same()` — use `check()` when you care about "does this look right as text?", use tap for structural equality.

## Setup

Import `tap-check.js` to add `t.check()` to all tap test objects. It patches `TestBase.prototype` via declaration merging and routes failures through `t.fail()` for clean YAML diagnostics:

```ts
import { test } from "tap";
import "agent-doctest/tap";

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

Wildcards in the expected string match variable text. There are two syntaxes:

### Guillemet wildcards (preferred)

Use `«»` delimiters with typed matchers and extractions:

```ts
t.check(timestamp, "created «date»");           // matches ISO date
t.check(record, '{"id": «uuid», "count": «int»}');  // typed fields
t.check(logLine, "commit «hash=*» by «author=*»");  // named captures
```

| Pattern | Matches | Name |
|---|---|---|
| `«*»` | anything | positional only |
| `«date»` | ISO date/datetime (`2026-03-02`, `2026-03-02T20:00:00Z`) | `date` |
| `«uuid»` | UUID (`550e8400-e29b-41d4-a716-446655440000`) | `uuid` |
| `«int»` | integer (`42`, `-5`) | `int` |
| `«number»` | number (`3.14`, `-5`, `1.5e-10`) | `number` |
| `«string»` | quoted string (`"hello"`, `'world'`, with escapes) | `string` |
| `«codeblock»` | triple backticks (`` ``` ``), use `«codeblock»xml` to match `` ```xml `` | `codeblock` |
| `«blankline»` | empty line (use in multi-line `=>` blocks where a real blank line would end the block) | `blankline` |
| `«name=*»` | anything | `name` |
| `«name=type»` | type's pattern | `name` |

When a token matches a known type (`date`, `uuid`, `int`, `number`, `string`), the type's regex is used and it captures with that name. Unknown tokens (like `«hash»`) match anything but are anonymous — use `«hash=*»` for named capture.

## Extractions

All wildcards capture the text they match. `check()` and `t.check()` return an extractions object with positional and named access:

```ts
const ext = t.check(logLine, "commit «hash=*» at «date»");
ext[0]     // "abc123"       — positional
ext[1]     // "2026-03-02"   — positional
ext.hash   // "abc123"       — named (via =*)
ext.date   // "2026-03-02"   — named (known type)
ext.length // 2
```

Named captures via `«name=type»`:

```ts
const ext = t.check(range, "from «start=date» to «end=date»");
ext.start  // "2026-01-01"
ext.end    // "2026-12-31"
```

When no wildcards are present, returns an empty array (length 0).

Async check returns a promise of extractions:

```ts
const ext = await t.check(asyncValue, "count: «int»");
ext.int  // "42"
```

`inspect()` includes extractions in the result:

```ts
const r = inspect(line, "commit «hash=*»");
r.extractions.hash  // "abc123"
```

On failure, `extractions` is an empty array.

## Wildcards in JSON

Wildcards work well for skipping fields in JSON objects. The only requirement is that the literal fragments you include must appear in the same order as the actual output (`JSON.stringify` field order is deterministic):

```ts
// Skip volatile fields, check the ones you care about:
t.check(body.briefs[0], `{«*»
  "relativePath": "box/output/briefs/2026-03-01_test.news-brief.card",
  "title": "Test Brief",
  "date": "2026-03-01",«*»
  "read": false
}`);
```

**Important:** Put wildcards on the same line as the preceding text (e.g., `{«*»` or `"2026-03-01",«*»`), not on their own indented line. A wildcard on its own line like:

```
  "date": "2026-03-01",
  «*»
  "read": false
```

adds an extra `\n  ` before AND after the wildcard in the regex. If the fields are adjacent in the actual JSON (nothing to skip), the pattern requires two `\n  ` sequences where only one exists, and the match fails. Keeping wildcards inline avoids this:

```
  "date": "2026-03-01",«*»
  "read": false
```

Fields must appear in their actual order — if `"date"` comes before `"read"` in the JSON, the expected string must list them in that order too.

## Serializers

Values are converted to strings for comparison using a chain of serializers. The built-in chain:

1. **Registered serializers** (tried in order, first non-null wins)
2. **Strings** pass through unchanged
3. **null/undefined** become `"null"` / `"undefined"`
4. **Objects** become `JSON.stringify(value, null, 2)`
5. **Everything else** uses `String(value)`

Register domain-specific serializers for readable test output:

```ts
import { registerSerializer } from "agent-doctest/check";

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

### HTTP response serializer

For route tests, `test/helpers/check-serializers.ts` registers a serializer for Fastify `inject()` responses that formats them as `statusCode\n{json body}`:

```ts
import "./helpers/check-serializers.js";

// Check status + body in one assertion:
t.check(res, `200\n{\n  "success": true\n}`);

// With wildcards for volatile fields:
t.check(res, `200\n«*»"items": []«*»`);
```

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
import { inspect } from "agent-doctest/check";

const r = inspect("actual", "expected");
r.pass;         // false
r.diff;         // the visual diff string
r.actual;       // "actual"
r.expected;     // "expected"
r.message;      // "check failed"
r.extractions;  // [] (empty on failure)
```

Useful for testing the diff format itself, or for programmatic comparison where you don't want assertion failures.

## Standalone check()

The standalone `check()` (from `check.js`, not `tap-check.js`) throws `CheckError` on mismatch instead of calling `t.fail()`. Returns extractions on success:

```ts
import { check, CheckError } from "agent-doctest/check";

const ext = check(result, "id: «uuid»");
ext.uuid;  // the matched UUID

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
import "agent-doctest/tap";
t.check(actual: unknown, expected: string | CheckOptions): Extractions | Promise<Extractions>

// Standalone (throws on mismatch, returns extractions on match)
import { check } from "agent-doctest/check";
check(actual: unknown, expected: string | CheckOptions): Extractions | Promise<Extractions>

// Non-throwing
import { inspect } from "agent-doctest/check";
inspect(actual: unknown, expected: string | CheckOptions): CheckResult | Promise<CheckResult>

// Serializers
serialize(value: unknown): string
registerSerializer(fn: (value: unknown) => string | null): void

// Types
type Extractions = string[] & Record<string, string>
type PrintFn = (text: string) => void
interface CheckOptions { expected: string; normalizeWhitespace?: boolean; label?: string }
interface CheckResult { pass: boolean; actual: string; expected: string; diff: string | null; message: string; extractions: Extractions }
class CheckError extends Error { diff: string; found: string; wanted: string }

// Wildcard types (built-in)
// «date»    — ISO date/datetime
// «uuid»    — UUID
// «int»     — integer
// «number»  — number (int, decimal, scientific)
// «string»  — quoted string ("..." or '...')
// «*»       — anything
// «name=*»  — anything, captured as "name"
// «name=type» — typed capture with custom name
```
