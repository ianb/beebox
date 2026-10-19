---
title: "Try the ai-deslop oxlint rules on our code"
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

## Part 2: test code (moot as first written)

Part 2 asked whether doctest code should be linted. The doctest format is
gone (`beebox/docs/implemented-plans/retire-doctest.md`, 2026-10-18): tests
are `.test.ts` files that ESLint lints and `tsc` typechecks. The test-file
deslop rules (`no-poor-substring-tests`, `no-repeated-expect-call`,
`no-call-only-assertions`) now apply to every test; part 1's run covers
them. `tap-check/check-whole-value` already rejects the substring and
boolean forms inside `t.check`.
