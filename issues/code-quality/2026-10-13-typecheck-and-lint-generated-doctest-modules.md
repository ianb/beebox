---
title: "Typecheck and lint doctests through the module agent-doctest generates"
workstream: doctest-typecheck
area: agent-doctest
labels: [tests, lint, typecheck]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "What do we compile the doctests into?", 2026-10-13
---

Doctest code is neither typechecked nor linted. About 1,000 `*.doctest.md`
files run through tsx/esbuild, which strips types without checking them.
A doctest that calls a changed API with the wrong argument shape fails only
when it runs, and only if it is selected. Part 2 of
[try the ai-deslop rules](2026-10-13-try-ai-deslop-rules-and-lint-doctest-code.md)
raised this. This issue owns the mechanism.

## What exists

`generateTestModule` in `agent-doctest/src/doctest-hooks/doctest-generate.ts`
turns one doctest file into one tap test module, as TypeScript source in
memory. `doctest-load.ts` passes it to esbuild. The module holds:

- a runtime prelude of plain-JS helpers (`__doctest_withPrints`,
  `__doctest_eventually` as `eventually`, a reference-error hint, a
  still-running watchdog);
- the ` ```ts setup ` blocks at top level, with imports rewritten;
- one `test("file.md:LINE — …", async (t) => { … })` per ` ```ts ` block,
  with ` ```ts continue ` blocks appended inside the previous block's
  function, so they share its scope;
- one `await t.check(actual, { expected, … })` per `=> expected` line;
- a line map (`line-map.ts`) from each generated line to its Markdown line.
  The loader already uses it to put esbuild errors and stack frames on the
  author's line.

So the generated module already has the real scope. Checking fenced blocks
one at a time would not: a lone `continue` block has undefined names.

## Direction

Write each generated module to a scratch directory, or give it to the
TypeScript and ESLint APIs in memory. Check it in the context of the
package it tests (its `tsconfig`, path aliases such as `@shared/*`). Map
each diagnostic back to the `.md` line through the line map.

What blocks a strict check now:

- The prelude is untyped JS and fails `noImplicitAny`. Type it, or move
  it to a typed module that the generated code imports.
- Authors write untyped helpers in setup blocks. Example: `render(data,
  { canEdit })` in
  `beebox/src/frontend/test/components/themes/ThemedFileCard/view/PropertiesFace.order-appearance.doctest.md`.
  A strict pass will report many of these at first.
- Some lint rules do not fit doctest code: bare expressions whose value is
  checked, top-level `await`, `print`, and the generated `__doctest_*` names.
  The doctest config needs its own overrides. Each override needs the
  boxholder's approval (root `AGENTS.md` on lint changes).

## Open questions

- Typecheck only, lint only, or both. Typechecking catches API drift. Lint
  enforces house style in code that is meant to be read.
- Where the check runs: in `test:changed` for the selected doctests, in
  pre-commit for staged `.doctest.md` files, or report-only first through a
  schedule while the backlog is counted.
- How to handle the backlog: per-file opt-in, a baseline of known findings,
  or fix everything once.
- Whether doctest-specific rules from `beebox/.claude/rules/doctest.md`
  belong in the same pass: `=> true` from a comparison, `JSON.stringify` in
  a checked expression, a block with no prose before it.

Start by measuring: generate the modules for one package, run `tsc
--noEmit` and ESLint over them, and count findings by rule and by file.

## Progress

2026-10-16, workstream `doctest-typecheck`. Scope from the boxholder:
typecheck, then fix the errors. Lint stays out of scope, since lint changes
need the boxholder's approval.

The checker is `doctest-typecheck` in agent-doctest
(`agent-doctest/src/typecheck/check.ts`, documented in its README). It builds one
TypeScript program per `--project` tsconfig with the generated modules as
virtual files beside each `.md`. It drops emit settings (`rootDir`, `outDir`)
and keeps every checking option. It maps each error to the markdown line. The
prelude is typed in `doctest-runtime.ts`. Type-only imports in example blocks
are hoisted for the check. Each package has a `typecheck:doctest` script.
None is wired into `typecheck`, `test:changed`, or pre-commit yet.

Baseline on 2026-10-16: 5,756 errors in 604 of 1,086 doctests.

| Package / tsconfig | Errors | Failing / checked |
|---|---:|---:|
| beebox `test/` (tsconfig.json) | 4,865 | 485 / 799 |
| beebox `src/frontend/test/` (src/frontend/tsconfig.json) | 833 | 94 / 194 |
| `bin/test/` (root tsconfig.json, run from beebox) | 21 | 5 / 37 |
| workstreams-app | 19 | 11 / 33 |
| scan-uploader | 9 | 5 / 14 |
| browse | 6 | 3 / 6 |
| agent-doctest | 3 | 1 / 3 |

beebox by directory: test/core 2,237; test/webapp 1,239;
src/frontend/test/components 511; test/cli 451; test/hub 250;
src/frontend/test/lib 193; test/services 122; test/lib 107;
test/publications 98; test/publish 80; test/dev 79;
src/frontend/test/machines 73; remaining directories under 35 each.

Top codes in beebox `test/`: TS7006 implicit-any parameter (1,184),
TS2532/18047/18048/2531 possibly undefined or null (about 1,200), TS2345
argument type (463), TS18046 unknown (425), TS2339 missing property (334),
TS2554 argument count (315). No error fell on generated code.
