---
title: "The box schema guide's example shows escaped backticks inside a TypeScript block"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: The escaped backticks are plain in `beebox/docs/box/schemas.md`.

The example schema in the box schema guide writes the `instructions` template
literal as `` instructions: \`# My Type Cards `` and closes it with `` \` ``.
Those backslashes are template-literal escapes that belong to the generator's
source string. In a TypeScript code block the example is not valid
TypeScript. The A-lending walk's agent did not copy it
([report](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), row R5); a later agent may.

## Where

- `beebox/docs/box/schemas.md:27` and `:31` (shipped as
  `box-docs/schemas.md`).
- `box-docs/` is gitignored build output copied from `beebox/docs/box/`, so
  fix the `docs/box` source only.
- Unverified origin: `beebox/src/core/box/templates.ts:30-38` builds a
  similar guide inside a template literal, where `` \` `` is correct. The
  example may have been copied from text like that. The text "My Type Cards"
  appears only in the guide.

## Fix

Replace the escaped backticks with plain ones in the guide, or give
`instructions` a plain string in the example. Then check that the shipped
copy is regenerated and that any doctest that quotes the guide still passes.
