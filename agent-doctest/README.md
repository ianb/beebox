# agent-doctest

Write tests as executable markdown. Each fenced code block becomes a [tap](https://node-tap.org/) test case. Prose between blocks is documentation.

````markdown
# String utilities

```ts setup
import { capitalize } from "../src/strings.js";
```

Capitalizes the first letter:

```
capitalize("hello")
=> Hello
```

Works with empty strings:

```
capitalize("")
=>
```
````

## Install

```bash
npm install --save-dev agent-doctest tap esbuild tsx
```

## Setup

Create a `.taprc` in your project root:

```yaml
plugin:
  - "!@tapjs/typescript"
node-arg:
  - --import=tsx
  - --import=agent-doctest/tap
  - --import=agent-doctest/loader
include:
  - test/**/*.test.ts
  - test/**/*.doctest.md
```

Run with `npx tap` or add `"test": "tap"` to your package scripts.

## Doctest syntax

Files ending in `.doctest.md` are transformed into tap test modules at load time.

### Setup blocks

` ```ts setup ` blocks run at module scope — use for imports and shared helpers:

````markdown
```ts setup
import { readFile } from "node:fs/promises";

function fixture(name) {
  return readFile(`test/fixtures/${name}`, "utf-8");
}
```
````

### Examples

Regular ` ``` ` blocks contain examples. An expression followed by `=>` is checked against the expected value:

````markdown
```
1 + 1
=> 2
```
````

Multiple examples in one block share scope (variables persist). Separate with blank lines:

````markdown
```
const list = [3, 1, 2];
list.sort();
list.length
=> 3

list.join(", ")
=> 1, 2, 3
```
````

### Multi-line expected values

Expected output continues on subsequent lines until a blank line or end of block:

````markdown
```
JSON.stringify({ a: 1, b: 2 }, null, 2)
=> {
  "a": 1,
  "b": 2
}
```
````

`=>` on its own line works the same way — expected starts on the next line:

````markdown
```
JSON.stringify({ a: 1, b: 2 }, null, 2)
=>
{
  "a": 1,
  "b": 2
}
```
````

### Statements

Lines ending with `;` are run as setup statements. The last non-semicolon expression is checked:

````markdown
```
const data = JSON.parse('{"x": 1}');
data.x
=> 1
```
````

### No assertion

Blocks without `=>` just verify the code doesn't throw:

````markdown
```
const map = new Map();
map.set("key", "value");
```
````

### Continue blocks

` ``` continue ` appends to the previous block's scope — use prose between code that shares variables:

````markdown
```
const counter = { value: 0 };
counter.value
=> 0
```

Increment and check:

``` continue
counter.value += 1;
counter.value
=> 1
```
````

### Cleanup blocks

` ``` cleanup ` registers teardown code via `t.teardown()`:

````markdown
```
const server = await startServer();
server.port
=> 3000
```

``` cleanup
await server.close();
```
````

### print()

Each test gets a `print()` function. Printed lines drain into the next `=>` assertion:

````markdown
```
print("step 1");
print("step 2");
"done"
=> step 1
step 2
done
```
````

## check() — String comparison

`t.check(actual, expected)` compares values as strings. It's available in all tests automatically (loaded via `.taprc`).

```ts
test("example", async (t) => {
  t.check("hello", "hello");
  t.check(42, "42");
  t.check({ a: 1 }, '{\n  "a": 1\n}');
});
```

Objects serialize as `JSON.stringify(value, null, 2)`. On mismatch you get a visual diff.

### Wildcards

Use `«»` wildcards for volatile values:

```ts
t.check(output, "created «date»");              // ISO date
t.check(record, '{"id": «uuid»}');              // UUID
t.check(line, "commit «hash=*» by «author=*»");  // named captures
t.check(response, '{"count": «int»}');           // integer
```

| Pattern | Matches | Default name |
|---|---|---|
| `«*»` | anything | (positional) |
| `«date»` | ISO date/datetime | `date` |
| `«uuid»` | UUID | `uuid` |
| `«int»` | integer | `int` |
| `«number»` | number (decimal, scientific) | `number` |
| `«string»` | quoted string | `string` |
| `«blankline»` | empty string (literal blank line) | — |
| `«codeblock»` | triple backticks | — |
| `«name=*»` | anything | `name` |
| `«name=type»` | type's pattern | `name` |

### Extractions

Wildcards capture matched text, returned from `t.check()`:

```ts
const ext = t.check(line, "commit «hash=*» at «date»");
ext.hash   // "abc123"
ext.date   // "2026-03-02"
ext[0]     // "abc123" (positional)
```

### Custom serializers

Register domain-specific serializers for readable assertions:

```ts
import { registerSerializer } from "agent-doctest/check";

registerSerializer((value) => {
  if (value && typeof value === "object" && "statusCode" in value) {
    const r = value as { statusCode: number; json: () => unknown };
    return `${r.statusCode}\n${JSON.stringify(r.json(), null, 2)}`;
  }
  return null;
});

// Now in tests:
t.check(response, `200\n{ "success": true }`);
```

## Exports

| Import | Contents |
|---|---|
| `agent-doctest/loader` | Node.js loader hook registration (use in `.taprc`) |
| `agent-doctest/tap` | Adds `t.check()` to tap (use in `.taprc`) |
| `agent-doctest/check` | `check()`, `inspect()`, `serialize()`, `registerSerializer()`, `CheckError` |
| `agent-doctest/hooks` | Parser functions: `parseCodeBlocks()`, `parseExamples()`, `generateTestSource()` |

## License

MIT
