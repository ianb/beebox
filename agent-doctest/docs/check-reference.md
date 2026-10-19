# checkText and checkThrows

`t.checkText(actual, expected)` compares text. `actual` is a string or a promise of one; `expected` is a string that may hold `«»` wildcards. Use it for command output and other rendered text. To compare a value, use `t.check` ([guide](../../beebox/docs/testing/check.md)); serialize nothing here.

`agent-doctest/tap` adds the method to every tap test object (`.taprc` loads it with `--import`; import it too for the TypeScript types).

```ts
import { test } from "tap";
import "agent-doctest/tap";

test("example", async (t) => {
  t.checkText(render(), "total: «int»");
  await t.checkText(runCommandText(), "ready");
});
```

Trailing newlines in `actual` are not compared. A promise makes the call return a promise: `await` it.

## Wildcards

| Pattern | Matches |
|---|---|
| `«*»` | anything, newlines and empty text included |
| `«date»` | ISO date or datetime (`2026-03-02`, `2026-03-02T20:00:00Z`) |
| `«uuid»` | UUID |
| `«int»` | integer (`42`, `-5`) |
| `«number»` | number (`3.14`, `-5`, `1.5e-10`) |
| `«string»` | quoted string (`"hello"`, `'world'`, with escapes) |
| `«blankline»` | an empty line |

An unknown token such as `«hash»` matches anything. Without a wildcard, the text must match exactly.

## Failure output

A failure reports through tap's YAML diagnostics:

- `diff`: one line shows `expected` and `actual` with a caret at the first difference; several lines show a line-by-line diff with long equal runs collapsed. Lines that match through a wildcard show as context.
- `suggested`: a paste-ready expected text, with volatile parts (dates, UUIDs, ids, temp paths, the pid) replaced by wildcards and blank lines by `«blankline»`. If that rewrite would not match, it is the raw actual text.
- `hint`: advice for a recognized mistake (a quoted string, a boolean, a difference only in trailing whitespace). Absent otherwise.

## checkThrows

`t.checkThrows(fn, expected)` checks that `fn` throws, or returns a promise that rejects. `"Name"` checks the error's name; `"Name: message"` checks both, and the message may hold wildcards. An async `fn` makes the call return a promise: `await` it.

```ts
t.checkThrows(() => parseDate("x"), "RangeError");
await t.checkThrows(() => load("missing"), "NotFound: no card «*»");
```

A failure reports `diff`, `suggested`, and `hint` as above, plus the caught error's `stack`. When `fn` does not throw, the compared text is `(no error thrown)`.
