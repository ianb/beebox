# Doctest syntax

A `.doctest.md` file is documentation whose code blocks are tests. The prose
explains the behaviour; each ` ```ts ` block shows it. Run one file from the
package that owns it:

```bash
cd beebox && pnpm exec tap test/lib/cookies.doctest.md
```

Tap run from the monorepo root has none of the package's loaders; it tells you
the command to use instead.

## A file

````markdown
# Cookie headers

```ts setup
import { parseCookieHeader } from "../../src/lib/cookies.js";
```

A header becomes a name → value map. Whitespace around pairs is dropped:

```ts
parseCookieHeader(" a=1 ; b=2 ")
=> { a: "1", b: "2" }
```

A malformed pair is skipped, not fatal, because the header is untrusted input:

```ts
parseCookieHeader("a=1; junk; b=%ZZ")
=> { a: "1" }
```
````

- ` ```ts setup ` runs once, at module scope: imports and helpers. Its
  declarations are visible in every block.
- ` ```ts ` is a test. Code runs top to bottom; each `=>` checks the value of
  the expression just above it.
- Prose goes **between** fences. A sentence inside a fence is code.
- Other languages (` ```json `, ` ```bash `, ` ```text `) are documentation and
  never run.

## What `=>` compares

The value of the last expression before `=>` is compared as text.

| Value | Write | Notes |
|---|---|---|
| string | `=> hello world` | no quotes: the string itself |
| number, boolean | `=> 42`, `=> true` | |
| object, array | `=> { a: "1", b: ["x"] }` | a JS literal or JSON; key order does not matter |
| multi-line | `=>` then the lines | ends at a blank line |
| an error | `=> throws TypeError` | or `=> throws TypeError: bad «*»` |

Do not wrap values in `JSON.stringify(...)`: write the object. Use
`JSON.stringify` only when the exact string matters (to show whitespace or an
empty string).

Several examples can share a block. A blank line between them is conventional;
code before an expression runs as statements, including `try`/`catch` and
loops:

```ts
const list = [3, 1, 2];
list.sort();
list
=> [1, 2, 3]

list.length
=> 3
```

Trailing newlines on strings are trimmed. A blank line inside expected output
is written `«blankline»`, because a real blank line ends the expected value.

## Don't know the value yet? Write `=> ?`

Write the expression, put `=> ?`, and run the file. The failure includes
`suggested:`, the actual value ready to paste, with the parts that vary already
replaced by wildcards:

```text
not ok 1 - line 12: JSON.parse(readFileSync(lockFile, "utf8"))
  suggested: |-
    {
      "pid": «int»,
      "hostname": "«*»",
      "acquiredAt": "«date»",
      "metadata": {
        "holder": "reviewer-a"
      }
    }
```

Check that the value is right before you paste it. A pasted value is the claim
the test makes.

## Show the value, not a yes/no

`=> true` hides what the code produced; when it fails, the diff says only
`true` versus `false`. Prefer the value, with wildcards for the parts that
vary:

```ts
// Weak: says nothing about what was recorded
recorded.pid === process.pid && typeof recorded.hostname === "string"
=> true

// Strong: shows the record; «int», «date» and «*» absorb what varies
recorded
=> { pid: «int», hostname: "«*»", acquiredAt: "«date»", metadata: { holder: "reviewer-a" } }
```

Better still, control the inputs (a fixed time, a fixed id) so nothing varies.

| Wildcard | Matches |
|---|---|
| `«*»` | anything |
| `«int»`, `«number»` | an integer, any number |
| `«date»` | an ISO date or date-time |
| `«uuid»` | a lowercase UUID |
| `«name=*»`, `«name=int»` | the same, captured under `name` |
| `«show»` (alone) | nothing is checked; the value is printed in the run as `# line N: … => value` |

A value that is only `«*»` is refused: it checks nothing. Use `=> ?` to get
the value, or `=> «show»` to record a value (a version, a timing) without
asserting it.

## Scope: blocks are separate tests

Each ` ```ts ` block is its own test; its variables are gone in the next block.
To keep building on the same variables with prose in between, continue the
block:

````markdown
```ts
const box = await makeTmpBox();
await box.write("a.card", "…");
```

The write shows up in the listing:

```ts continue
await box.list()
=> ["a.card"]
```
````

A ` ```ts continue ` block shares the variables of the block it continues, so
declare each name once. Values every test needs go in ` ```ts setup `.

## Cleanup

- ` ```ts cleanup ` tears down the test it follows (and its `continue` blocks),
  even when an example fails. Put it after the last block that uses the
  resource.
- ` ```ts teardown ` runs once, after every test in the file: for resources
  created in `setup`.

## Waiting

`eventually(fn, { label, timeoutMs })` calls `fn` until it returns a value
other than `false`, `null` or `undefined`, and returns that value. When time
runs out it throws `EventuallyTimeout: <label> was not true after <n>ms` with
the last value or error. Use it instead of a fixed `sleep`:

```ts
await eventually(() => existsSync(outPath), { label: "the output file appears" })
=> true
```

A fence can set how long an example may run before the runner notes which
example is still running: ` ```ts timeout=120s `.

## Reading a failure

- `not ok 3 - line 42: parse(input)` names the markdown line of the example.
- `diff:` lines marked `-` are expected, `+` are actual.
- `suggested:` is the actual value, ready to paste.
- `hint:` appears when the mistake is recognisable (quotes around a string,
  prose in a fence, a name from another block).
- `DoctestSyntaxError file.md:39:` means the file could not become a test; it
  shows the line and the first lines of its block.
- Stack traces point at `.doctest.md` lines.

## `print()`

`print("text")` collects lines that are checked, together with the next
expression's value, by the next `=>`:

```ts
print("step 1");
print("step 2");
"done"
=> step 1
step 2
done
```
