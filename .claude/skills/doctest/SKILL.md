---
name: doctest
description: Run, edit, and triage existing beebox `.doctest.md` tests until they are converted, including distinguishing flakes from regressions and rerunning before claiming a fix. New tests are `.test.ts` with `t.check` (beebox/docs/testing/check.md). Use when an existing doctest fails or must change.
---

# Doctests: author, run, triage

> **Testing cutover (since 2026-10-18).** Write new tests as `.test.ts` files that
> use `t.check` ([reference](../../../beebox/docs/testing/check.md)). Do not create `.doctest.md` files;
> pre-commit rejects them. Existing doctests are being converted (plan
> [retire-doctest](../../../beebox/docs/plans/retire-doctest.md)). If your change affects an existing doctest, edit
> it in place; the conversion picks up your edit. If git reports a
> modify/delete conflict on a doctest that was converted, convert your
> version with `node agent-doctest/bin/doctest-to-ts.mjs <file>`.

Use this skill for existing doctests until they are converted.

The [syntax reference](../../../agent-doctest/docs/syntax.md) is short and
example-first; read it before writing a doctest. Whether a doctest is the
right instrument at all: [choosing an instrument](../../../beebox/docs/testing.md#choosing-an-instrument).

## Authoring

Create `test/<name>.doctest.md`, mirroring the `src/` path. A good model:
`beebox/test/core/pdf/probe.text-layer-quality.test.ts`.

- **The prose is the document.** Open with the contract or the incident behind
  the code. The sentence before each example says what rule it shows and where
  the rule comes from: the issue or plan, the format, a calculation the reader
  can redo, or the bug it replays. A value that is a choice (order, wording)
  says so.
- **One claim per example.** Passing with the code deleted, or re-proving
  another example's branch, is a defect. Exploration keeps only the cases
  that failed ([testing](../../../beebox/docs/testing.md)).
- **Show values.** Write objects as literals (`=> { kind: "box" }`), not
  `JSON.stringify(...)`. Prefer the value to `=> true`.
- **Unknown or varying value:** write `=> ?`, run, and paste the `suggested:`
  value once the sentence says why that exact value is right. Varying parts
  arrive as wildcards (`«int»`, `«date»`, `«*»`); better, pass fixed inputs.
- **Waiting:** `eventually(fn, { label })`, never a fixed sleep.
- Blocks are separate tests; ` ```ts continue ` shares variables (prose between
  examples goes after a closing fence, never inside an open one), ` ```ts setup `
  holds imports and helpers, ` ```ts cleanup ` / ` ```ts teardown ` release
  resources.

## Running

- One file, **from the package directory**: `cd beebox && pnpm exec tap test/<path>.doctest.md`
- What your diff implicates: `pnpm test:changed`; the full suite is hourly on
  `main`. Rule out contention with `-j1`.
- If tap itself cannot start (a missing module under `node_modules/@tapjs`),
  stop and report it. Do not reinstall or delete `node_modules`; other
  sessions share it.

**Never declare a doctest fixed without running it.** Reproduce the failure,
then rerun after the fix.

## Reading a failure

`not ok N - line 42: <expr>` names the markdown line; `diff:` has `-` expected
and `+` actual; `suggested:` is the actual value, ready to paste after the
check above. The rest, including `DoctestSyntaxError` and hangs, is in the
syntax reference.

## Flake triage

The suite runs 6 files in parallel (`beebox/.taprc`); not every red run is
your bug. Rerun the file alone first. A failure that reproduces alone, even on
the unmodified tree, is a real bug however long it has been red. Most past
flakes were test-caused: a fixed sleep or unsettled wait (use `eventually`), a
budget sized for an idle machine, or a resource a failed example left open
(use `cleanup`). The full protocol is in `.claude/agents/finish.md`; file new
flake shapes in `issues/bugs/` with the `issues` skill.
