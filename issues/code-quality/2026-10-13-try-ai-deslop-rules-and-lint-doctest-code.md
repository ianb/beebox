---
title: "Try the ai-deslop oxlint rules on our code, and decide whether doctest code should be linted"
workstream: unattached
area: beebox
labels: [lint, tests]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder re-reading deslop, 2026-10-13
---

[ai-deslop](https://github.com/maharshi365/deslop) is a set of oxlint rules
against patterns that AI agents write. Its generic rules come from
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). The boxholder
took ideas from one of the two earlier; this repo records no trace of which.
The repo was created 2026-09-13 and has had many changes since.

## Part 1: one run of each rule

Run each rule once, report-only, over `beebox/`, `bin/`, and
`workstreams-app/`. Record the count and a sample of findings per rule. Do
not change code or config in that run. Candidates, most likely to find real
problems first:

- `no-duplicate-types` with the Zod adapter (opt-in): identical object
  contracts across files, including a Zod schema that repeats a TypeScript
  type. Agents often redefine a shape in a new file.
- `no-duplicate-consts` (opt-in): ALL_CAPS constants with the same value in
  different files.
- `no-runtime-typeof`: ad hoc `typeof` narrowing where the input should be
  parsed at the boundary.
- `require-safety-comment-for-type-assertion`, `no-widen-then-assert`,
  `no-chained-type-assertions`.
- `no-unknown-parameters`, `no-unknown-returns`, `no-known-value-widening`.
- `no-conditional-empty-object-spread`: we use `...(x === null ? {} : {…})`
  often, sometimes for `exactOptionalPropertyTypes`. The count may show the
  rule does not fit us.
- Test rules (`no-poor-substring-tests`, `no-repeated-expect-call`,
  `no-call-only-assertions`): they apply only to our `.test.ts` files.

Personal-vibe-check already sets `no-unnecessary-condition`,
`no-floating-promises`, and `consistent-type-assertions` as errors.

The weekly `schedules/supplemental-lint/` run is report-only oxlint. It is
the place for rules that find real problems but are too noisy to block. A
rule that finds only real problems, with few findings, can go into
`personal-vibe-check/` after the findings are fixed. Changing lint config
needs the boxholder's approval (root `AGENTS.md`).

## Part 2: doctest code is not linted

There are ~1,000 `*.doctest.md` files. ESLint has no Markdown processor
configured, and the code blocks are not part of any `tsc` project. Doctests
run through tsx, which strips types without checking them. Doctest code
can therefore hold patterns the linter rejects everywhere else. Example: a
helper with untyped parameters in
`beebox/src/frontend/test/components/themes/ThemedFileCard/PropertiesFace.order-appearance.doctest.md`.

Tensions:

- Doctest code is documentation. Some code-only rules do not fit it:
  bare expressions as checked values, top-level `await`, and `continue`
  blocks that share scope.
- A Markdown processor (`@eslint/markdown` code blocks) would have to
  rebuild the setup/continue scope that agent-doctest builds
  (`agent-doctest/src/doctest-hooks/doctest-split.ts`, `doctest-generate.ts`).
  Without it, blocks lint out of context, with false "undefined" errors.
  agent-doctest already generates a module per file. Linting or typechecking
  that generated module may be simpler.
- Typechecking may give more than linting: a doctest that calls a changed
  API with the wrong shape fails only at run time now.
- Doctest-specific checks from
  `beebox/.claude/rules/doctest.md` could be lint rules: `=> true` from a
  comparison, `JSON.stringify` in a checked expression, a block with no prose
  before it. Compare with deslop's `no-poor-substring-tests` and
  `no-repeated-expect-call`, which are test-file versions of the same idea.

Start by measuring: lint or typecheck the generated modules for a sample of
doctests, and count findings per rule, before deciding.
