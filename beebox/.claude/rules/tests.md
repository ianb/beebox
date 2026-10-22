---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

A test compares whole values with `t.check(actual, expected)`. Full reference:
`beebox/docs/testing/check.md` (monorepo-relative); the `tests` skill covers
running and triage. The rules that matter most:

- **Comment.** The top comment says what the file covers. A comment before a
  check says what rule it shows and where the rule comes from, when the code
  does not make that plain.
- **Whole value.** Write the value the code produces, as a literal. Do not check
  a length, a boolean, a comparison, or `JSON.stringify(x)`; lint rejects them.
- **Unknown or varying value:** leave the expected value out, run the file from
  the package directory (`cd beebox && pnpm exec tap test/<path>.test.ts`), and
  paste the `suggested:` value after you check it. Use a pattern (`any(String)`,
  `uuid()`, `isoDate()`) only where the value varies between runs. Better: pass
  a fixed clock or id.
- **Await promises.** `await t.check(promise, ...)`. Do not `void` a check.
- **Cleanup.** `t.teardown(...)` releases what the test created.
- **Waiting:** `eventually(fn, { label })`, never a fixed sleep.
- **No tap value asserts** (`t.equal`, `t.same`, `t.ok`): use `t.check`.
- **Types are checked.** `pnpm typecheck` checks the expected value against the
  actual value's type. Type the code under test, not around it: no `any`, and
  on a checked line use `?.` only where a missing value would still show
  differently.
