# Getting started

Write tests with `t.check(actual, expected)` alongside tap. The expected value is code, and the type checker checks it against the actual value's type.

```ts
import { test } from "tap";
import { any } from "agent-doctest/check";

void test("safeFilename strips special characters", async (t) => {
  t.check(safeFilename("Hello World!"), "Hello_World");
  t.check(await getStatus(boxRoot), { staged: [], modified: [], untracked: [], clean: true });
  t.check(await createNote("Draft"), { id: any(String), title: "Draft" });
});
```

`agent-doctest/tap` adds the methods to every tap test object. The `.taprc` in the [README](../README.md) loads it with `--import`.

For patterns, matching rules, how to find the expected value, and how to read a failure, see [testing with t.check](../../beebox/docs/testing/check.md).

## Text and errors

- `t.checkText(actual, text)` compares the value's text. The text may hold `«»` wildcards. Use it for command output. Details: [check-reference.md](check-reference.md).
- `t.checkThrows(fn, "Name")` or `t.checkThrows(fn, "Name: message")` checks that `fn` throws or rejects. A rejection counts as the throw. `await` the call.

```ts
await t.checkThrows(() => parseDate("not-a-date"), "RangeError: Invalid date string");
```

On failure, the caught error's stack trace is in the tap diagnostics.

## Lint

Enable the three rules from `agent-doctest/eslint` on test files. See the [README](../README.md#lint-rules).
