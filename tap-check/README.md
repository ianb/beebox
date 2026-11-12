# tap-check

The `t.check` plugin for [tap](https://node-tap.org/), and the lint rules that keep `t.check` tests strong.

The package began as a runner for executable markdown (`.doctest.md`). That format is gone. The name stays.

## What it gives you

`t.check(actual, expected)` compares a whole value. The expected value is code. The type checker checks it against the actual value's type. A failed check prints a diff and a paste-ready suggested value.

```ts
import { test } from "tap";
import { any } from "@ianbicking/tap-check/check";

void test("a note has an id and a title", async (t) => {
  t.check(await createNote("Draft"), { id: any(String), title: "Draft" });
});
```

Also on the test object: `t.checkText` (a string with `«»` wildcards) and `t.checkThrows` (an error by name or message).

The full guide, with patterns and failure output, is [testing with t.check](../beebox/docs/testing/check.md).

## Install

```bash
npm install --save-dev @ianbicking/tap-check tap tsx
```

Create a `.taprc` in your project root:

```yaml
plugin:
  - "!@tapjs/typescript"
node-arg:
  - --import=tsx
  - --import=@ianbicking/tap-check/tap
include:
  - test/**/*.test.ts
```

Run with `npx tap`.

## Exports

| Import | Contents |
|---|---|
| `@ianbicking/tap-check/tap` | Adds `t.check`, `t.checkText`, and `t.checkThrows` to tap (use in `.taprc`) |
| `@ianbicking/tap-check/check` | Patterns (`any`, `uuid`, `isoDate`, `oneOf`, `str`, `optional`, `unordered`, `containing`, `capture`, `others`, `anything`, `not`, `is`, `instanceOf`), `eventually` and `runCommand` |
| `@ianbicking/tap-check/eslint` | ESLint plugin: `check-whole-value`, `no-voided-check`, `no-tap-assert` |

## Lint rules

Enable the rules on test files:

```ts
import tapCheck from "@ianbicking/tap-check/eslint";

export default [
  {
    files: ["test/**/*.ts"],
    plugins: { "tap-check": tapCheck },
    rules: {
      "tap-check/check-whole-value": "error",
      "tap-check/no-voided-check": "error",
      "tap-check/no-tap-assert": "error",
      "tap-check/no-text-locator": "error",
    },
  },
];
```

- `check-whole-value`: do not check a length, a boolean, a comparison, or `JSON.stringify(x)`. Check the value.
- `no-voided-check`: do not `void` a check. Await it, so a failure is not lost.
- `no-tap-assert`: use `t.check`, not `t.equal`, `t.same`, or `t.ok`.
- `no-text-locator`: do not find a DOM element by reading `textContent` or `innerText` in a `.find`, `.filter`, or `.some` callback. Find it by id or by role and accessible name. Reading the text to check it is allowed.

## Docs

- [Getting started](docs/getting-started.md)
- [Text comparison reference](docs/check-reference.md): `t.checkText`, `t.checkThrows`, wildcards, failure output.

## Status

An experiment. Conceived by [Ian Bicking](https://ianbicking.org) ([bsky](https://bsky.app/profile/ianbicking.org)), written entirely by Claude Code. Fork it and explore what you want to do with it. I would love to hear what you learn.

## License

MIT
