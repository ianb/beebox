# agent-doctest

The `t.check` plugin for [tap](https://node-tap.org/), and the lint rules that keep `t.check` tests strong.

The package began as a runner for executable markdown (`.doctest.md`). That format is gone. The name stays.

## What it gives you

`t.check(actual, expected)` compares a whole value. The expected value is code. The type checker checks it against the actual value's type. A failed check prints a diff and a paste-ready suggested value.

```ts
import { test } from "tap";
import { any } from "agent-doctest/check";

void test("a note has an id and a title", async (t) => {
  t.check(await createNote("Draft"), { id: any(String), title: "Draft" });
});
```

Also on the test object: `t.checkText` (text with `«»` wildcards) and `t.checkThrows` (an error by name or message).

The full guide, with patterns and failure output, is [testing with t.check](../beebox/docs/testing/check.md).

## Install

```bash
npm install --save-dev agent-doctest tap tsx
```

Create a `.taprc` in your project root:

```yaml
plugin:
  - "!@tapjs/typescript"
node-arg:
  - --import=tsx
  - --import=agent-doctest/tap
include:
  - test/**/*.test.ts
```

Run with `npx tap`.

## Exports

| Import | Contents |
|---|---|
| `agent-doctest/tap` | Adds `t.check`, `t.checkText`, and `t.checkThrows` to tap (use in `.taprc`) |
| `agent-doctest/check` | Patterns (`any`, `uuid`, `isoDate`, `oneOf`, `str`, `optional`, `unordered`, `containing`, `capture`, `others`, `anything`), `eventually`, `runCommand`, `printed`, and the text-comparison API |
| `agent-doctest/eslint` | ESLint plugin: `check-whole-value`, `no-voided-check`, `no-tap-assert` |

## Lint rules

Enable the rules on test files:

```ts
import agentDoctest from "agent-doctest/eslint";

export default [
  {
    files: ["test/**/*.ts"],
    plugins: { "agent-doctest": agentDoctest },
    rules: {
      "agent-doctest/check-whole-value": "error",
      "agent-doctest/no-voided-check": "error",
      "agent-doctest/no-tap-assert": "error",
    },
  },
];
```

- `check-whole-value`: do not check a length, a boolean, a comparison, or `JSON.stringify(x)`. Check the value.
- `no-voided-check`: do not `void` a check. Await it, so a failure is not lost.
- `no-tap-assert`: use `t.check`, not `t.equal`, `t.same`, or `t.ok`.

## Docs

- [Getting started](docs/getting-started.md)
- [Text comparison reference](docs/check-reference.md): `t.checkText`, wildcards, serializers.

## Status

An experiment. Conceived by [Ian Bicking](https://ianbicking.org) ([bsky](https://bsky.app/profile/ianbicking.org)), written entirely by Claude Code. Fork it and explore what you want to do with it. I would love to hear what you learn.

## License

MIT
