---
name: tests
description: Write, run, and triage beebox `.test.ts` tests that use `t.check`, including distinguishing flakes from regressions and rerunning before claiming a fix. Use when you add a test, when a test fails, or when a change needs a test.
---

# Tests: write, run, triage

The reference is [testing with t.check](../../../beebox/docs/testing/check.md):
patterns, matching rules, helpers, service fakes, and DOM tests. Which
instrument fits a change: [choosing an instrument](../../../beebox/docs/testing.md#choosing-an-instrument).

## Writing

Create `test/<name>.test.ts`, mirroring the `src/` path. A good model:
`beebox/test/core/pdf/probe.text-layer-quality.test.ts`.

- **A comment is the document.** The top comment names the contract or the
  incident behind the code. A comment before a check says what rule it shows
  and where the rule comes from: the issue or plan, the format, a calculation
  the reader can redo, or the bug it replays. A value that is a choice (order,
  wording) says so.
- **One claim per test.** A test that passes with the code deleted, or that
  re-proves another test's branch, is a defect. Exploration keeps only the
  cases that failed ([testing](../../../beebox/docs/testing.md)).
- **Check the whole value.** Write objects as literals. Do not check a length,
  a boolean, `.success`, `.code`, `includes`, or `JSON.stringify(x)`; lint
  rejects some of these and the rest pass when the behavior is wrong.
- **Not a generated set.** Do not paste a listing, a package file list, an
  id table, rendered HTML, or a helper's whole output as the expected value,
  and do not mirror a catalog or registry row by row. These fail on every
  intended change and have caught nothing on `main`. Pin the rows the claim
  names ([a strong test](../../../beebox/docs/testing/check.md#a-strong-test)).
- **Unknown or varying value:** leave the expected value out, run, and paste the
  `suggested:` value once you can say why that exact value is right. Use a
  pattern only where the value varies between runs; better, pass a fixed clock
  or id.
- **Waiting:** `eventually(fn, { label })`, never a fixed sleep.
- **Cleanup:** `t.teardown(...)` right after you create the resource, so a
  failed check cannot leave it open.

## Running

- One file, **from the package directory** (`beebox/`, frontend tests too): `pnpm exec tap test/<path>.test.ts`
- What your diff implicates: `pnpm test:changed`; `-j1` rules out contention. The full
  suite runs hourly on `main`. After a URL shape or class string changes, grep tests for the old literal.
- If tap cannot start (a missing module under `node_modules/@tapjs`), stop and
  report it. Do not reinstall or delete `node_modules`; other sessions share it.

**Never declare a test fixed without running it.** Reproduce the failure, then
rerun after the fix.

## Reading a failure

A failure prints `mismatches` (path, expected, actual), `diff`, and `suggested`
(the expected value rewritten to match). Fix the code when the behavior is
wrong. Fix the expected value when the behavior is right. `pnpm typecheck`
checks test files with the rest of the code.

## Flake triage

The suite runs 6 files in parallel (`beebox/.taprc`); not every red run is your
bug. Rerun the file alone first. A failure that reproduces alone is a real bug,
even when it predates your change. A check that went red right after an
intended change to a scaffold, a fixture, or a catalog is neither: it is a snapshot of a generated set. Narrow it to the
rows the claim names; do not paste the new `suggested:` value and move on. Most past flakes
were test-caused: a fixed sleep or unsettled wait (use `eventually`), a budget
sized for an idle machine, or a resource a failed test left open (use
`t.teardown`). The full protocol is in `.claude/agents/finish.md`; file new
flake shapes in `issues/bugs/` with the `issues` skill.
